import { Vector2 } from 'three';
export class DartNavigation {
  constructor(saved = null) {
    this.target = 'didymos'; this.dispersionM = new Vector2(135, -67); this.deltaVMps = 0;
    this.locked = false; this.corrections = 0; this.lastFrame = false; this.impact = null; this.cubeFrames = []; this.cubeAimingDeg = 0;
    if (saved) {
      if (saved.version !== 1 || !saved.dispersionM?.every(Number.isFinite) || saved.dispersionM.length !== 2
        || !Number.isFinite(saved.deltaVMps) || saved.deltaVMps < 0 || saved.deltaVMps > 2) throw new Error('Invalid DART guidance state');
      for (const key of Object.keys(this)) if (Object.hasOwn(saved, key)) this[key] = structuredClone(saved[key]);
      this.dispersionM = new Vector2(...saved.dispersionM);
    }
  }
  acquire(target, secondsToImpact) {
    if (this.locked || secondsToImpact > 3600 || secondsToImpact < 150 || !['didymos', 'dimorphos'].includes(target)) return false;
    this.target = target; return true;
  }
  correct(x, y, secondsToImpact) {
    if (this.locked || this.target !== 'dimorphos' || secondsToImpact < 150 || secondsToImpact > 3600 || ![x, y].every(Number.isFinite)) return false;
    const dv = Math.hypot(x, y);
    if (dv <= 0 || dv > .2 || this.deltaVMps + dv > 2) return false;
    this.dispersionM.addScaledVector(new Vector2(x, y), secondsToImpact); this.deltaVMps += dv; this.corrections++; return true;
  }
  solveAutomatically(secondsToImpact) {
    if (!this.acquire('dimorphos', secondsToImpact) || this.corrections) return;
    this.correct(-this.dispersionM.x / secondsToImpact, -this.dispersionM.y / secondsToImpact, secondsToImpact);
  }
  serialize() { return { version: 1, ...this, dispersionM: this.dispersionM.toArray() }; }
}
