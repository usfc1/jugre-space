import { crewSources, foodKgS, metabolism, readCabinProfile, waterKgS } from './cabin-profile.mjs';
import { finite } from './mission-units.mjs';

const gasConstant = 8.31446261815324;
const molarMass = { o2: .0319988, n2: .0280134, co2: .0440095, vapor: .01801528 };
const keys = Object.keys(molarMass);
const co2LimitPa = 3 * 133.322387415;
const inspiredMinimumPa = 139 * 133.322387415;
const waterVaporLungsPa = 47 * 133.322387415;
const oxygenFractionWater = molarMass.o2 / (2 * molarMass.vapor);
const initialTemperatureK = 297.2;
const initialPressurePa = 101325;
const initialWaterVaporPa = 1200;
const waterLatentHeatJkg = 2.45e6;
const stepS = 1;
const poweredSystems = ['power', 'ventilation', 'scrubber', 'electrolysis', 'waterRecovery', 'thermal', 'reserve'];
const sum = values => values.reduce((a, b) => a + b, 0);
const metabolicCache = new WeakMap();
const historyCache = new WeakMap();

function initialGas(volumeM3) {
  const dryPa = initialPressurePa - initialWaterVaporPa;
  const pressure = { o2: dryPa * .2095, co2: dryPa * .0004, n2: dryPa * .7901, vapor: initialWaterVaporPa };
  return Object.fromEntries(keys.map(key => [key, pressure[key] * volumeM3 * molarMass[key] / (gasConstant * initialTemperatureK)]));
}

export function atmosphereReading(gas, volumeM3, temperatureK) {
  return measureAtmosphere(gas, volumeM3, temperatureK, { partialPa: {} });
}

function measureAtmosphere(gas, volumeM3, temperatureK, result) {
  const { partialPa } = result;
  let pressurePa = 0;
  for (const key of keys) {
    partialPa[key] = gas[key] * gasConstant * temperatureK / (molarMass[key] * volumeM3);
    pressurePa += partialPa[key];
  }
  const oxygenFraction = pressurePa > 0 ? partialPa.o2 / pressurePa : 0;
  const inspiredOxygenPa = Math.max(0, pressurePa - waterVaporLungsPa) * oxygenFraction;
  const celsius = temperatureK - 273.15;
  const saturationPa = 610.94 * Math.exp(17.625 * celsius / (celsius + 243.04));
  result.pressurePa = pressurePa;
  result.oxygenFraction = oxygenFraction;
  result.inspiredOxygenPa = inspiredOxygenPa;
  result.humidity = partialPa.vapor / saturationPa;
  result.temperatureK = temperatureK;
  return result;
}

export function cabinConfiguration(spec, cabins) {
  if (!spec.crewCount || !spec.cabin || cabins.length !== 1) return null;
  const module = cabins[0];
  const { oxygenPersonMinutes, batteryKWh } = module.stats;
  const catalogOxygenKg = module.stats.maxOxygenKg ?? oxygenPersonMinutes * 60 * metabolism.nominal.o2;
  if (!Number.isFinite(catalogOxygenKg) || !Number.isFinite(batteryKWh) || module.stats.crewSeats < spec.crewCount) return null;
  return { profile: spec.cabin, module: module.part, seats: module.stats.crewSeats, crewCount: spec.crewCount,
    catalogOxygenKg, batteryJ: batteryKWh * 3600000 };
}

export function assessCabin(plan, cabins) {
  const { spec } = plan;
  const result = (id, label, status, reason, actual = null, required = null, unit = null, source = crewSources.baseline) => ({
    id, label, status, reason, actual, required, unit, phase: 'duration', source,
  });
  const limits = (id, label, actual, required, unit, reason, source) => result(id, label, actual + 1e-10 >= required ? 'PASS' : 'FAIL', reason, actual, required, unit, source);
  const duration = spec.durationS;
  const count = spec.crewCount;
  const nominal = metabolism.nominal;
  const time = duration == null ? null : duration * (1 + spec.safetyMargin);
  const configuration = cabinConfiguration(spec, cabins);
  const reports = [];
  if (time != null) reports.push(result('crew-demand', 'Duration with reserve', 'PASS', 'Nominal activity estimate.', time, duration, 's'));
  if (!configuration) {
    reports.push(result('crew-model', 'Life support', 'UNKNOWN', 'Select a cabin with enough seats, battery, oxygen, and configured systems.'));
    const oxygenMinutes = cabins.reduce((total, cabin) => total + (cabin.stats.oxygenPersonMinutes ?? 0), 0);
    if (time != null) reports.push(limits('oxygen', 'Rated O₂ supply', oxygenMinutes, time * count / 60, 'person·min', 'Estimate from rated supplies.'));
    return { checks: reports, configuration, addedMassKg: 0 };
  }
  const p = configuration.profile;
  const gas = initialGas(p.volumeM3);
  const addedMassKg = p.equipmentKg + p.oxygenKg + p.waterKg + p.foodKg + sum(Object.values(gas));
  const normalOxygenKg = p.oxygenKg - p.reserveKg;
  reports.push(limits('oxygen-capacity', 'O₂ capacity', configuration.catalogOxygenKg, p.oxygenKg, 'kg', 'Rated supply limit.', 'JUGRE catalog'));
  reports.push(limits('oxygen-flow', 'O₂ delivery', p.oxygenDeliveryKgH, nominal.o2 * count * 3600, 'kg/h', 'Nominal consumption.'));
  if (time != null) {
    reports.push(limits('oxygen', 'O₂ supply', normalOxygenKg, nominal.o2 * count * time, 'kg', 'Estimate excluding emergency reserve and regeneration.'));
    reports.push(limits('water', 'Drinking water', p.waterKg, waterKgS * count * time, 'kg', 'Supply before regeneration.', crewSources.consumables));
    reports.push(limits('food', 'Food', p.foodKg, foodKgS * count * time, 'kg', 'Dry food for the mission duration.', crewSources.consumables));
    const co2Headroom = Math.max(0, co2LimitPa * p.volumeM3 * molarMass.co2 / (gasConstant * initialTemperatureK) - gas.co2);
    reports.push(limits('scrubber', 'CO₂ capacity', Math.min(p.scrubberCapacityKg, p.scrubberKgH * time / 3600) + co2Headroom,
      nominal.co2 * count * time, 'kg', 'Scrubber and cabin buffer at initial temperature.'));
    const watts = p.busW + p.ventilationW + p.scrubberW + p.thermalW + p.electrolysisW + p.recoveryW;
    reports.push(limits('power', 'Electrical energy', (configuration.batteryJ + p.generationW * time) / 3600000,
      watts * time / 3600000, 'kWh', 'Simultaneous equipment demand.'));
  }
  reports.push(result('crew-basis', 'Cabin data', 'WARNING', 'User-defined equipment characteristics.'));
  return { checks: reports, configuration, addedMassKg };
}

export class CrewLifeSupport {
  #atmosphere = { partialPa: {} };

  constructor(configuration, saved = null) {
    const { module, crewCount, batteryJ } = configuration;
    this.config = structuredClone(configuration);
    this.profile = readCabinProfile(configuration.profile);
    const p = this.profile;
    this.gas = initialGas(p.volumeM3);
    this.temperatureK = initialTemperatureK;
    this.oxygenKg = p.oxygenKg - p.reserveKg;
    this.reserveKg = p.reserveKg;
    this.waterKg = p.waterKg;
    this.foodKg = p.foodKg;
    this.batteryJ = batteryJ;
    this.scrubberKg = p.scrubberCapacityKg;
    this.wastewaterKg = 0;
    this.retainedKg = 0;
    this.ventedKg = 0;
    this.pendingS = 0;
    this.seconds = 0;
    this.leakKgS = 0;
    this.powerW = 0;
    this.co2AveragePa = 0;
    this.co2History = [];
    this.alerts = [];
    this.controls = Object.fromEntries(poweredSystems.map(id => [id, id !== 'reserve']));
    this.powered = {};
    this.crew = Array.from({ length: crewCount }, (_, index) => ({
      id: `crew-${index + 1}`, role: index === 0 ? 'Commander' : 'Specialist', module, activity: 'nominal',
      awakeS: 0, sleepS: 0, lowOxygenS: 0, highCo2S: 0, peakG: 0, properGSeconds: 0,
    }));
    if (saved) this.restore(saved);
  }

  reading() { return atmosphereReading(this.gas, this.profile.volumeM3, this.temperatureK); }

  readiness(remainingS = 0) {
    const p = this.profile;
    const nominal = metabolism.nominal;
    const o2Rate = sum(this.crew.map(member => metabolism[member.activity].o2));
    const oxygen = this.oxygenKg + (this.controls.reserve ? this.reserveKg : 0);
    const watts = p.ventilationW + p.busW + p.scrubberW + p.thermalW + p.electrolysisW + p.recoveryW;
    const powerTime = this.controls.power ? watts > p.generationW ? this.batteryJ / (watts - p.generationW) : Infinity : 0;
    const enduranceS = Math.min(oxygen / (o2Rate || nominal.o2), this.waterKg / (this.crew.length * waterKgS),
      this.foodKg / (this.crew.length * foodKgS), powerTime);
    return { ready: this.alerts.length === 0 && enduranceS >= remainingS, enduranceS, alerts: this.alerts };
  }

  advance(seconds, environment, stopWhen = null) {
    finite(seconds, 'Life support timestep', 0, 3600);
    const pending = this.pendingS;
    let processed = 0;
    this.pendingS += seconds;
    while (this.pendingS >= stepS - 1e-9) {
      this.pendingS = Math.max(0, this.pendingS - stepS);
      processed += stepS;
      this.tick(stepS, environment);
      if (stopWhen?.(this)) {
        this.pendingS = 0;
        return Math.max(0, processed - pending);
      }
    }
    return seconds;
  }

  setActivity(id, activity) {
    const member = this.crew.find(person => person.id === id);
    if (!member || !Object.hasOwn(metabolism, activity)) throw new Error('Invalid crew activity');
    member.activity = activity;
    metabolicCache.delete(this);
  }

  setControl(id, enabled) {
    if (!poweredSystems.includes(id) || typeof enabled !== 'boolean') throw new Error('System not found');
    this.controls[id] = enabled;
  }

  tick(dt, { leakKgS = 0, exteriorPa = 0, properG = 0, generationFactor = 1 } = {}) {
    const p = this.profile;
    const generated = this.controls.power ? p.generationW * generationFactor * dt : 0;
    let available = this.controls.power ? this.batteryJ + generated : 0;
    this.powerW = 0;
    const usePower = (id, watts, installed = true) => {
      const supplied = installed && this.controls.power && this.controls[id] !== false && available >= watts * dt;
      if (supplied) { available -= watts * dt; this.powerW += watts; }
      this.powered[id] = supplied;
      return supplied;
    };
    usePower('bus', p.busW);
    const ventilation = usePower('ventilation', p.ventilationW);
    const scrubber = usePower('scrubber', p.scrubberW, ventilation && p.scrubberKgH > 0 && this.scrubberKg > 0);
    const thermal = usePower('thermal', p.thermalW, p.heatRejectionW > 0);
    let rates=metabolicCache.get(this);
    if(!rates){rates={o2:0,co2:0,vapor:0,heatW:0};for(const member of this.crew)for(const key of Object.keys(rates))rates[key]+=metabolism[member.activity][key];metabolicCache.set(this,rates);}
    const o2Demand = rates.o2 * dt;
    const generator = usePower('electrolysis', p.electrolysisW, p.electrolysisKgH > 0 && this.waterKg > 0
      && this.gas.o2 - o2Demand < this.nominalOxygenKg);
    const recovery = usePower('waterRecovery', p.recoveryW, p.recoveryKgH > 0 && this.wastewaterKg > 0);
    if (this.controls.power) this.batteryJ = Math.min(this.config.batteryJ, available);

    const o2Used = Math.min(this.gas.o2, o2Demand);
    const food = Math.min(this.foodKg, foodKgS * this.crew.length * dt);
    const water = Math.min(this.waterKg, waterKgS * this.crew.length * dt);
    const co2 = Math.min(food + o2Used, rates.co2 * dt * (o2Used / o2Demand));
    const vapor = Math.min(water, rates.vapor * dt);
    this.gas.o2 -= o2Used;
    this.gas.co2 += co2;
    this.gas.vapor += vapor;
    this.foodKg -= food;
    this.waterKg -= water;
    this.wastewaterKg += water - vapor;
    this.retainedKg += food + o2Used - co2;

    if (recovery) {
      const processed = Math.min(this.wastewaterKg, p.recoveryKgH * dt / 3600);
      const recovered = Math.min(p.waterKg - this.waterKg, processed * p.recoveryFraction);
      this.waterKg += recovered;
      this.wastewaterKg -= processed;
      this.retainedKg += processed - recovered;
    }
    if (generator) {
      const oxygen = Math.min(p.electrolysisKgH * dt / 3600, this.waterKg * oxygenFractionWater, Math.max(0, this.nominalOxygenKg - this.gas.o2));
      const waterUsed = oxygen / oxygenFractionWater;
      this.gas.o2 += oxygen;
      this.waterKg -= waterUsed;
      this.ventedKg += waterUsed - oxygen;
    }
    const oxygen = Math.min(p.oxygenDeliveryKgH * dt / 3600, Math.max(0, this.nominalOxygenKg - this.gas.o2),
      this.oxygenKg + (this.controls.reserve ? this.reserveKg : 0));
    const main = Math.min(oxygen, this.oxygenKg);
    this.oxygenKg -= main;
    this.reserveKg -= oxygen - main;
    this.gas.o2 += oxygen;
    if (scrubber) {
      const captured = Math.min(this.gas.co2, this.scrubberKg, p.scrubberKgH * dt / 3600);
      this.scrubberKg -= captured;
      this.gas.co2 -= captured;
      this.retainedKg += captured;
    }

    const reading = measureAtmosphere(this.gas, p.volumeM3, this.temperatureK, this.#atmosphere);
    const heatW = rates.heatW + this.powerW;
    const rejectedW = thermal ? Math.min(p.heatRejectionW, heatW + Math.max(0, this.temperatureK - initialTemperatureK) * p.thermalJK / dt) : 0;
    if (thermal && reading.partialPa.vapor > initialWaterVaporPa) {
      const excessKg = this.gas.vapor * (1 - initialWaterVaporPa / reading.partialPa.vapor);
      const condensedKg = Math.min(excessKg, (p.heatRejectionW - rejectedW) * dt / waterLatentHeatJkg);
      this.gas.vapor -= condensedKg;
      this.wastewaterKg += condensedKg;
    }
    this.temperatureK += (heatW - rejectedW) * dt / p.thermalJK;
    // Effective leak rating at nominal cabin-to-vacuum differential. Scale
    // by positive differential, then remove the mixed gas in mass proportions.
    this.leakKgS = Math.max(0, leakKgS) * Math.max(0, reading.pressurePa - exteriorPa) / initialPressurePa;
    if (this.leakKgS > 0) {
      let gasKg = 0;
      for (const key of keys) gasKg += this.gas[key];
      const leakedKg = Math.min(gasKg, this.leakKgS * dt);
      if (gasKg > 0) for (const key of keys) this.gas[key] *= 1 - leakedKg / gasKg;
      this.ventedKg += leakedKg;
    }
    const current = measureAtmosphere(this.gas, p.volumeM3, this.temperatureK, this.#atmosphere);
    this.seconds += dt;
    const minute = Math.floor((this.seconds - 1) / 60);
    if (this.co2History.at(-1)?.minute !== minute) {
      this.co2History.push({ minute, samples: 0, sumPa: 0 });
      if (this.co2History.length > 60) this.co2History.shift();
      historyCache.delete(this);
    }
    let totals=historyCache.get(this);
    if(!totals){totals={count:sum(this.co2History.map(bucket=>bucket.samples)),pressure:sum(this.co2History.map(bucket=>bucket.sumPa))};historyCache.set(this,totals);}
    const sample = this.co2History.at(-1);
    sample.samples++;
    sample.sumPa += current.partialPa.co2;
    totals.count++;totals.pressure+=current.partialPa.co2;
    const co2Mean = totals.pressure / totals.count;
    this.alerts = [];
    if (current.inspiredOxygenPa < inspiredMinimumPa) this.alerts.push('low-oxygen');
    this.co2AveragePa = co2Mean;
    if (co2Mean > co2LimitPa) this.alerts.push('high-co2');
    if (current.pressurePa <= 34500 || current.pressurePa > 103000) this.alerts.push('cabin-pressure');
    if (current.humidity > .75) this.alerts.push('humidity');
    if (current.temperatureK > 300.15) this.alerts.push('temperature');
    if (!ventilation) this.alerts.push('ventilation');
    if (!this.controls.power || !this.powered.bus) this.alerts.push('power');
    if (p.scrubberKgH > 0 && !scrubber) this.alerts.push('scrubber');
    if (o2Used < o2Demand || this.oxygenKg + (this.controls.reserve ? this.reserveKg : 0) <= 0) this.alerts.push('oxygen-reserve');
    if (this.waterKg <= 0 || this.foodKg <= 0) this.alerts.push('consumables');
    for (const member of this.crew) {
      if (member.activity === 'sleep') { member.sleepS += dt; member.awakeS = 0; }
      else member.awakeS += dt;
      if (this.alerts.includes('low-oxygen')) member.lowOxygenS += dt;
      if (this.alerts.includes('high-co2')) member.highCo2S += dt;
      member.peakG = Math.max(member.peakG, properG);
      member.properGSeconds += properG * dt;
    }
  }

  get nominalOxygenKg() {
    return (initialPressurePa - initialWaterVaporPa) * .2095 * this.profile.volumeM3 * molarMass.o2 / (gasConstant * initialTemperatureK);
  }

  serialize() {
    const { config, profile, ...state } = this;
    return { version: 1, ...structuredClone(state) };
  }

  restore(saved) {
    metabolicCache.delete(this);historyCache.delete(this);
    if (saved.version !== 1 || saved.crew?.length !== this.config.crewCount || !Array.isArray(saved.alerts)
      || !Array.isArray(saved.co2History) || saved.co2History.length > 60) throw new Error('Invalid cabin save');
    for (const key of ['oxygenKg', 'reserveKg', 'waterKg', 'foodKg', 'batteryJ', 'scrubberKg', 'wastewaterKg', 'retainedKg',
      'ventedKg', 'pendingS', 'seconds', 'leakKgS', 'powerW', 'temperatureK', 'co2AveragePa']) {
      const capacities = { oxygenKg: this.profile.oxygenKg - this.profile.reserveKg, reserveKg: this.profile.reserveKg,
        waterKg: this.profile.waterKg, foodKg: this.profile.foodKg, batteryJ: this.config.batteryJ, scrubberKg: this.profile.scrubberCapacityKg, pendingS: 1 };
      this[key] = finite(key === 'co2AveragePa' ? saved[key] ?? 0 : saved[key], key, key === 'temperatureK' ? 1 : 0, capacities[key] ?? Number.MAX_VALUE);
    }
    for (const key of keys) this.gas[key] = finite(saved.gas?.[key], key, 0, 1e6);
    for (const key of poweredSystems) this.setControl(key, saved.controls?.[key]);
    this.crew.forEach((member, index) => {
      const original = saved.crew[index];
      this.setActivity(member.id, original.activity);
      for (const key of ['awakeS', 'sleepS', 'lowOxygenS', 'highCo2S', 'peakG', 'properGSeconds']) member[key] = finite(original[key], key, 0, Number.MAX_VALUE);
    });
    this.co2History = saved.co2History.map(bucket => ({ minute: finite(bucket.minute, 'CO₂ time', 0, Number.MAX_VALUE),
      samples: finite(bucket.samples, 'CO₂ samples', 1, 60), sumPa: finite(bucket.sumPa, 'CO₂ pressure', 0, Number.MAX_VALUE) }));
    if (saved.alerts.some(alert => typeof alert !== 'string')) throw new Error('Invalid cabin alerts');
    this.alerts = [...saved.alerts];
    this.powered = Object.fromEntries(['bus', ...poweredSystems].filter(key => typeof saved.powered?.[key] === 'boolean').map(key => [key, saved.powered[key]]));
  }
}
