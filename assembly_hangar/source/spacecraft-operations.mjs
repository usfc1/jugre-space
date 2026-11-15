import { Vector3 } from 'three';
import { EARTH_OMEGA, EARTH_RADIUS_M, geographicUp, surfaceToInertialVelocity } from './flight-coordinates.mjs';
import { keplerState } from './orbital-propagator.mjs';
import { spacecraftTotals } from './spacecraft-design.mjs';

const stepS = 5;
const radians = Math.PI / 180;
const efficiency = .92;
const antennaNadir = 70;
export function distanceLimitedDownlink(rangeKm, referenceKm, referenceMBs) {
  if (!(rangeKm > 0 && referenceKm > 0 && referenceMBs > 0)) return 0;
  return referenceMBs * Math.min(1, (referenceKm / rangeKm) ** 2);
}
const stationRows = [
  ['Florida', 28.61, -80.60], ['Ecuador', -.2, -78.5], ['Hawaii', 19.8, -155.5],
  ['Canary Islands', 28.3, -16.5], ['Cape Town', -33.9, 18.4], ['Oman', 23.6, 58.4],
  ['Australia', -31.9, 115.9], ['Japan', 31.3, 131.1], ['Chile', -30.2, -70.8],
];
const stations = stationRows.map(([name, lat, lon]) => {
  const up = geographicUp(lat, lon);
  return { name, up, positionM: up.clone().multiplyScalar(EARTH_RADIUS_M),
    ratesMBs: { S: .4, X: 3 }, minElevationDeg: 10 };
});

export function stationContact(positionM, radio) {
  const nadir = positionM.clone().normalize().negate();
  let best = null;
  for (const station of stations) {
    const toCraft = positionM.clone().sub(station.positionM);
    const rangeM = toCraft.length();
    if (rangeM <= 0 || !Object.hasOwn(station.ratesMBs, radio.band)) continue;
    toCraft.divideScalar(rangeM);
    const elevationDeg = Math.asin(Math.max(-1, Math.min(1, toCraft.dot(station.up)))) / radians;
    if (elevationDeg < station.minElevationDeg || nadir.angleTo(toCraft.negate()) / radians > Math.min(antennaNadir, radio.pointingDeg)) continue;
    const quality = Math.min(1, (700000 / rangeM) ** 2) * (.45 + .55 * Math.sin(elevationDeg * radians));
    const rateMBs = Math.min(radio.rateMBs, station.ratesMBs[radio.band]) * quality;
    if (!best || rateMBs > best.rateMBs) best = { name: station.name, elevationDeg, rateMBs };
  }
  return best;
}

export function earthShadow(positionM, sunDirection) {
  const alongSun = positionM.dot(sunDirection);
  return alongSun < 0 && positionM.lengthSq() - alongSun ** 2 < EARTH_RADIUS_M ** 2;
}

function finiteVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

export class SpacecraftOperations {
  constructor(config, saved) {
    this.config = config;
    this.design = spacecraftTotals(config);
    this.orbit = null;
    this.elapsedS = 0;
    this.integratedS = 0;
    this.batteryWh = this.design.battery.capacityWh;
    this.generatedMB = 0;
    this.storedMB = 0;
    this.downlinkedMB = 0;
    this.lostMB = 0;
    this.scienceEnabled = true;
    this.radioEnabled = true;
    this.safe = false;
    this.solarW = 0;
    this.loadW = 0;
    this.eclipsed = false;
    this.contact = null;
    this.reason = 'Awaiting separation';
    this.history = [];
    this.queue = this.design.selected.map(item => ({ id: item.id, remainingMB: config.downlinkGoalMB }));
    this.target = config.targetLatDeg == null ? null : geographicUp(config.targetLatDeg, config.targetLonDeg);
    if (saved) this.restore(saved);
  }

  deploy(positionM, velocityMps, missionS) {
    if (this.orbit || positionM.length() <= EARTH_RADIUS_M) return false;
    this.orbit = { positionM: positionM.toArray(), velocityMps: surfaceToInertialVelocity(positionM, velocityMps).toArray(), missionS };
    this.reason = 'Payload separated';
    return true;
  }

  positionAt(seconds) {
    const position = new Vector3().fromArray(this.orbit.positionM).multiplyScalar(.001);
    const velocity = new Vector3().fromArray(this.orbit.velocityMps).multiplyScalar(.001);
    return keplerState(position, velocity, seconds).position.multiplyScalar(1000)
      .applyAxisAngle(new Vector3(0, 1, 0), -EARTH_OMEGA * seconds);
  }

  queueTask(id) {
    if (this.queue.length >= 32 || !this.design.selected.some(item => item.id === id)) throw new Error('Operation unavailable or queue full');
    this.queue.push({ id, remainingMB: this.config.downlinkGoalMB });
  }

  observeTarget(item, position, sunDirection, eclipsed) {
    if (!item.orbitSupported || item.pointingDeg < this.design.attitude.accuracyDeg) return false;
    if (item.geometry === 'local') return true;
    const up = position.clone().normalize();
    if (this.target && this.target.angleTo(up) > 12 * radians) return false;
    return item.geometry !== 'sunlit' || (!eclipsed && (this.target ?? up).dot(sunDirection) > 0);
  }

  advance(seconds, onEvent = () => {}) {
    if (!this.orbit || !(seconds > 0) || !Number.isFinite(seconds)) return;
    this.elapsedS += seconds;
    while (this.integratedS + stepS <= this.elapsedS + 1e-8) {
      this.tick(onEvent);
      this.integratedS += stepS;
    }
  }

  tick(onEvent) {
    const { battery, radio, computer, standbyW, selected, solarW } = this.design;
    const seconds = this.integratedS + stepS / 2;
    const position = this.positionAt(seconds);
    // Solar direction starts on the +X axis at liftoff in this educational epoch.
    const sun = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), -EARTH_OMEGA * (this.orbit.missionS + seconds));
    this.eclipsed = earthShadow(position, sun);
    this.solarW = this.eclipsed ? 0 : solarW;
    this.contact = stationContact(position, radio);
    const availableW = this.solarW + Math.min(battery.dischargeW, this.batteryWh * efficiency * 3600 / stepS);
    const wasSafe = this.safe;
    if (availableW < standbyW) this.safe = true;
    else if (this.batteryWh >= battery.capacityWh * .2 || this.solarW >= standbyW) this.safe = false;
    if (this.safe !== wasSafe) onEvent(this.safe ? 'satelliteSafeMode' : 'satelliteRecovered', { reason: this.safe ? 'Power shortfall' : 'Power restored' });
    const taskIndex = this.scienceEnabled ? this.queue.findIndex(task => {
      const instrument = selected.find(item => item.id === task.id);
      return this.observeTarget(instrument, position, sun, this.eclipsed) && availableW >= standbyW + instrument.peakW - instrument.standbyW;
    }) : -1;
    this.loadW = Math.min(availableW, this.safe ? 8 : standbyW);
    this.reason = this.safe ? 'Safe mode · power shortfall' : 'Awaiting science or contact window';
    if (!this.safe && this.radioEnabled && this.contact && this.storedMB > 0 && availableW >= standbyW + radio.drawW) {
      const sent = Math.min(this.storedMB, this.contact.rateMBs * stepS);
      this.storedMB -= sent;
      this.downlinkedMB += sent;
      this.loadW += radio.drawW;
      this.reason = `Downlink · ${this.contact.name}`;
    } else if (!this.safe && taskIndex >= 0) {
      const task = this.queue[taskIndex];
      const instrument = selected.find(item => item.id === task.id);
      const raw = Math.min(task.remainingMB, instrument.rateMBs * stepS);
      const stored = Math.min(raw, computer.storageMB - this.storedMB);
      this.generatedMB += raw;
      this.lostMB += raw - stored;
      this.storedMB += stored;
      task.remainingMB -= stored;
      this.loadW += instrument.activeW - instrument.standbyW;
      this.reason = stored < raw ? 'Storage full · data lost' : `Observation · ${instrument.name}`;
      if (task.remainingMB <= 1e-8) this.queue.splice(taskIndex, 1);
    } else if (!this.safe && this.storedMB > 0 && !this.radioEnabled) {
      this.reason = 'Radio off';
    }
    const surplusW = this.solarW - this.loadW;
    const deltaWh = surplusW >= 0 ? Math.min(surplusW, battery.chargeW) * efficiency * stepS / 3600
      : surplusW / efficiency * stepS / 3600;
    this.batteryWh = Math.max(0, Math.min(battery.capacityWh, this.batteryWh + deltaWh));
    if (this.integratedS % 30 === 0) {
      if (this.history.length === 120) this.history.shift();
      this.history.push([this.integratedS + stepS, this.batteryWh, this.loadW]);
    }
  }

  forecast() {
    if (!this.orbit) return [];
    const windows = [];
    let last = null;
    for (let offset = 0; offset <= 10800; offset += 30) {
      const seconds = this.integratedS + offset;
      const contact = stationContact(this.positionAt(seconds), this.design.radio);
      if (contact && last?.name === contact.name) last.endS = this.orbit.missionS + seconds;
      else if (contact) {
        last = { name: contact.name, startS: this.orbit.missionS + seconds, endS: this.orbit.missionS + seconds };
        windows.push(last);
      } else last = null;
      if (windows.length > 6) break;
    }
    return windows.slice(0, 6);
  }

  serialize() {
    const { orbit, elapsedS, integratedS, batteryWh, generatedMB, storedMB, downlinkedMB, lostMB, scienceEnabled,
      radioEnabled, safe, solarW, loadW, eclipsed, contact, reason, queue, history } = this;
    return structuredClone({ version: 1, orbit, elapsedS, integratedS, batteryWh, generatedMB, storedMB,
      downlinkedMB, lostMB, scienceEnabled, radioEnabled, safe, solarW, loadW, eclipsed, contact, reason, queue, history });
  }

  restore(data) {
    const numbers = ['elapsedS', 'integratedS', 'batteryWh', 'generatedMB', 'storedMB', 'downlinkedMB', 'lostMB', 'solarW', 'loadW'];
    const flags = ['scienceEnabled', 'radioEnabled', 'safe', 'eclipsed'];
    const validOrbit = data.orbit === null || (finiteVector(data.orbit?.positionM) && finiteVector(data.orbit.velocityMps)
      && Math.hypot(...data.orbit.positionM) > EARTH_RADIUS_M && Number.isFinite(data.orbit.missionS) && data.orbit.missionS >= 0);
    const validContact = data.contact === null || (stations.some(station => station.name === data.contact?.name)
      && [data.contact.elevationDeg, data.contact.rateMBs].every(Number.isFinite) && data.contact.rateMBs > 0);
    const balanced = Math.abs(data.generatedMB - data.storedMB - data.downlinkedMB - data.lostMB) <= 1e-7 * Math.max(1, data.generatedMB);
    if (data.version !== 1 || !validOrbit || !validContact || !balanced || data.integratedS % stepS !== 0 || data.integratedS > data.elapsedS + 1e-8
      || data.elapsedS - data.integratedS >= stepS + 1e-8 || numbers.some(key => !Number.isFinite(data[key]) || data[key] < 0)
      || flags.some(key => typeof data[key] !== 'boolean') || data.batteryWh > this.design.battery.capacityWh || data.storedMB > this.design.computer.storageMB
      || typeof data.reason !== 'string' || data.reason.length > 240
      || !Array.isArray(data.history) || data.history.length > 120 || !data.history.every(finiteVector)
      || !Array.isArray(data.queue) || data.queue.length > 32 || data.queue.some(task => !this.design.selected.some(item => item.id === task?.id)
        || !(task.remainingMB > 0 && task.remainingMB <= this.config.downlinkGoalMB))) throw new Error('Invalid spacecraft state');
    const keys = ['orbit', ...numbers, ...flags, 'contact', 'reason', 'queue', 'history'];
    for (const key of keys) this[key] = structuredClone(data[key]);
  }
}
