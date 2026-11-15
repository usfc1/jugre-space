import { MathUtils } from 'three';
import { terrainHeight, surfaceRocks } from './planet-terrain.mjs';

export const marsEdlSites = [[0, 0], [28, 24], [-56, 40], [18, -36], [65, -24]];
const gravity = 3.71;
export function evaluateMarsSite(index, terrain = 0) {
  const point = marsEdlSites[index];
  if (!point) return null;
  const [x, z] = point;
  const slope = Math.atan(Math.hypot(terrainHeight('mars', x + 2, z, terrain) - terrainHeight('mars', x - 2, z, terrain),
    terrainHeight('mars', x, z + 2, terrain) - terrainHeight('mars', x, z - 2, terrain)) / 4);
  const obstacle = surfaceRocks(terrain).some(r => r.radius > .25 && Math.hypot(r.x - x, r.z - z) < r.radius + 2);
  return { x, z, slopeDeg: slope * 180 / Math.PI, safe: slope < .16 && !obstacle };
}

// Educational single-plane atmospheric descent with discrete hardware commands.
export class MarsEdlControl {
  constructor(terrainNavigation, saved = null) {
    this.terrainNavigation = terrainNavigation; this.phase = 'entry'; this.seconds = 0;
    this.heightM = 125000; this.verticalMps = -610; this.horizontalMps = 5430; this.rangeM = 440000; this.bank = 0;
    this.fuelKg = 460; this.selectedSite = terrainNavigation ? null : 0; this.terrainDeadlineS = null;
    this.ropeM = 0; this.ropeRateMps = 0; this.craneDistanceM = 0; this.craneAltitudeM = 0; this.chute = false;
    this.heatshield = true; this.backshell = true; this.tethers = true; this.touchdownMps = null;
    this.reason = '';
    if (saved) {
      if (saved.version !== 1 || ![saved.seconds, saved.heightM, saved.verticalMps, saved.horizontalMps, saved.fuelKg].every(Number.isFinite)) throw new Error('Invalid Mars descent state');
      for (const key of Object.keys(this)) if (key !== 'terrainNavigation' && Object.hasOwn(saved, key)) this[key] = saved[key];
    }
  }
  get speedMps() { return Math.hypot(this.verticalMps, this.horizontalMps); }
  get chuteWindow() { return this.phase === 'entry' && this.heightM <= 16500 && this.heightM >= 5500 && this.speedMps <= 550 && this.rangeM < 160000; }
  fail(reason, emit) { this.phase = 'failed'; this.reason = reason; emit('marsEdlFailed', { reason, speedMps: this.speedMps }); }
  command(command, emit, siteIndex) {
    const terrain = this.terrainNavigation ? 0 : 1;
    if (command === 'parachute' && this.chuteWindow) {
      this.chute = true; this.phase = 'parachute';
      emit('rangeTrigger', { heightM: this.heightM, rangeM: this.rangeM, speedMps: this.speedMps }); return true;
    }
    if (command === 'shield' && this.phase === 'parachute' && this.speedMps <= 200) {
      this.heatshield = false;
      if (this.terrainNavigation) this.terrainDeadlineS = this.seconds + 10;
      emit('heatshieldSeparated', { separated: true, altitudeM: this.heightM }); return true;
    }
    if (command === 'site' && !this.heatshield && this.terrainNavigation && this.seconds <= this.terrainDeadlineS) {
      const site = evaluateMarsSite(siteIndex, terrain);
      if (!site?.safe) return false;
      this.selectedSite = siteIndex; emit('safeSiteSelected', { index: siteIndex, slopeDeg: site.slopeDeg, safe: site.safe }); return true;
    }
    if (command === 'backshell' && this.phase === 'parachute' && !this.heatshield && this.selectedSite !== null && this.heightM <= 2100 && this.heightM >= 500) {
      this.backshell = false; this.phase = 'powered';
      emit('backshellSeparated', { separated: true, altitudeM: this.heightM }); return true;
    }
    if (command === 'cut' && this.phase === 'contact' && this.touchdownMps <= .75) {
      this.tethers = false; this.phase = 'flyaway'; this.craneAltitudeM = this.heightM;
      emit('tethersCut', { cut: true, ropeM: this.ropeM }); return true;
    }
    return false;
  }
  advance(dt, axes, automatic, emit) {
    while (dt > 1e-7 && !['completed', 'failed'].includes(this.phase)) {
      const h = Math.min(.1, dt); dt -= h; this.seconds += h;
      this.bank = MathUtils.clamp(this.bank + (axes?.roll ?? 0) * h * .35, -1.3, 1.3);
      if (this.phase === 'entry' || this.phase === 'parachute') {
        const chute = this.chute;
        const air = .020 * Math.exp(-this.heightM / 11000);
        const drag = air * this.speedMps * (chute ? .14 : .004);
        const lift = chute ? 0 : gravity * .65 * Math.cos(this.bank) * Math.min(1, this.horizontalMps / 1500);
        this.horizontalMps *= Math.exp(-drag * h);
        this.verticalMps = this.verticalMps * Math.exp(-drag * h) + (lift - gravity) * h;
        this.heightM += this.verticalMps * h; this.rangeM = Math.max(0, this.rangeM - this.horizontalMps * h);
        if (automatic) {
          this.command('parachute', emit);
          if (this.heatshield) this.command('shield', emit);
          if (this.terrainNavigation && this.selectedSite === null) this.command('site', emit, 0);
          this.command('backshell', emit);
        }
        if (this.terrainDeadlineS !== null && this.seconds > this.terrainDeadlineS && this.selectedSite === null) this.fail('Safe landing site not selected', emit);
        else if (this.heightM < (this.chute ? 480 : 5200)) this.fail(this.chute ? 'Backshell still attached' : 'Parachute window missed', emit);
      } else if (this.phase === 'powered') {
        const desiredDown = -Math.min(42, Math.max(.8, (this.heightM - 7.5) * .21));
        const acceleration = MathUtils.clamp(gravity + (desiredDown - this.verticalMps) * .8 + (axes?.throttle ?? 0) * 2, 0, 16);
        const mass = 1660 + this.fuelKg, flow = acceleration * mass / 2300;
        this.fuelKg -= flow * h;
        this.verticalMps += (acceleration - gravity) * h;
        this.horizontalMps *= Math.exp(-.6 * h);
        this.heightM += this.verticalMps * h;
        emit('poweredDescent', { thrustN: acceleration * mass, fuelKg: this.fuelKg });
        if (this.fuelKg <= 0 || this.heightM <= 0) this.fail('Descent engines could not arrest the fall', emit);
        else if (this.heightM <= 7.5 && Math.abs(this.verticalMps) <= 1.4) { this.phase = 'crane'; this.heightM = 7.5; this.verticalMps = 0; }
      } else if (this.phase === 'crane') {
        this.ropeRateMps = automatic ? .65 : MathUtils.clamp(this.ropeRateMps + (axes?.throttle ?? 0) * -.3 * h, 0, 2);
        this.ropeM += this.ropeRateMps * h; this.fuelKg -= 3 * h;
        if (this.ropeM >= this.heightM) {
          this.ropeM = this.heightM; this.touchdownMps = this.ropeRateMps;
          if (this.touchdownMps > .75) this.fail('Rover impact', emit);
          else { this.phase = 'contact'; emit('skyCraneTouchdown', { verticalMps: this.touchdownMps, ropeM: this.ropeM }); }
        }
      } else if (this.phase === 'contact') {
        this.fuelKg -= 3 * h;
        if (automatic) this.command('cut', emit);
      } else if (this.phase === 'flyaway') {
        this.craneDistanceM += 12 * h; this.craneAltitudeM += 2 * h; this.fuelKg -= 2 * h;
        if (this.craneDistanceM >= 24) { this.phase = 'completed'; emit('craneFlyaway', { clearanceM: this.craneDistanceM }); }
      }
      if (this.fuelKg <= 0 && !['failed', 'completed'].includes(this.phase)) this.fail('Sky crane fuel depleted', emit);
    }
  }
  serialize() { return { version: 1, ...this }; }
}
