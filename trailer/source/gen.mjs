// node gen.mjs <missionId> <targetKind|event:<id>> [length=full|short] [extraSeconds] [out]
import { FlightState } from '../../assembly_hangar/source/flight-missions.mjs';
import { writeFileSync } from 'node:fs';
const [id, target, length = 'full', extra = '0', out] = process.argv.slice(2);
const s = new FlightState(id, 'command', { flightLength: length });
s.preflight = s.countdown = 0;
const reached = () => target.startsWith('event:')
  ? ['COMPLETE', 'SKIPPED'].includes(s.timeline.events.find(e => e.id === target.slice(6))?.status)
  : s.kind === target;
for (let i = 0; i < 4000 && !reached() && !s.failed; i++) {
  if (s.kind === 'ascent') s.update(1, {}, 1, () => false);
  else { s.paused = true; await s.skipNextEvent(); }
}
let left = Number(extra);
while (left > 0 && !s.failed) { const d = Math.min(1, left); s.paused = false; s.update(d, {}, 1, () => false); left -= d; }
s.paused = true;
console.log(id, 'kind', s.kind, 'phase', s.phaseIndex, 'time', s.time.toFixed(1), 'total', s.totalTime.toFixed(0), 'failed', s.failed, s.failureReason ?? '');
console.log('events', s.timeline.events.map(e => `${e.id}:${e.status}`).join(' '));
const save = { version: 1, state: s.serialize(), visual: { staged: true, upperStaged: true, boostersReleased: true, recoverySeconds: 0 }, rigid: null, interior: null };
writeFileSync(out || `ckpt/${id}-${target.replace(':', '_')}-${length}.json`, JSON.stringify(save));
