import { Vector3, MathUtils } from 'three';
import { PAD_EAST, PAD_NORTH } from './flight-coordinates.mjs';
export class WorldSmokeTrail {
  constructor(capacity = 180) {
    this.capacity = capacity; this.points = []; this.last = null;
    this.windMps = PAD_EAST.clone().multiplyScalar(3).addScaledVector(PAD_NORTH, 1.4);
  }
  reset() { this.points.length = 0; this.last = null; }
  sample(time, emitting, nozzleWorldM) {
    while (this.points.length && time - this.points[0].time > 26) this.points.shift();
    if (!emitting) { this.last = null; return; }
    if (this.last && time <= this.last.time) return;
    if (this.last && nozzleWorldM.distanceToSquared(this.last.point) < 35 ** 2 && time - this.last.time < .3) return;
    const end = { point: nozzleWorldM.clone(), time };
    if (this.last) {
      const count = MathUtils.clamp(Math.ceil(nozzleWorldM.distanceTo(this.last.point) / 65), 1, 64);
      for (let i = 1; i < count; i++) this.points.push({ point: this.last.point.clone().lerp(nozzleWorldM, i / count), time: MathUtils.lerp(this.last.time, time, i / count) });
    }
    this.points.push(end); this.last = end;
    if (this.points.length > this.capacity) this.points.splice(0, this.points.length - this.capacity);
  }
  renderPosition(puff, time, floatingOriginM, inverseFrame, out = new Vector3()) {
    // Both emission and wind live in ECEF metres. Only the final subtraction
    // and rotation enter the camera-relative rendering frame.
    return out.copy(puff.point).addScaledVector(this.windMps, Math.max(0, time - puff.time)).sub(floatingOriginM).applyQuaternion(inverseFrame);
  }
}
