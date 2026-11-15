import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { LaunchDynamics } from './launch-dynamics.mjs';
import { launchVehicles, vehicleForMission, launchSources } from './launch-vehicles.mjs';
import { physicsSample, trajectoryCSV, trajectoryReport } from './flight-diagnostics.mjs';

const folder = new URL('../diagnostics/', import.meta.url);
await mkdir(folder, { recursive: true });
const records = {}, summary = [];
for (const [id, vehicle] of [...Object.entries(launchVehicles), ['custom-engineering', vehicleForMission('custom')]]) {
  const p = new LaunchDynamics(vehicle);
  let at12;
  for (let t = 0; t < 1500 && !p.orbitAchieved && !p.crashed; t++) {
    p.advance(1);
    if (t === 11) at12 = physicsSample(p);
  }
  assert.equal(p.crashed, false, `${id} crashed`);
  assert.equal(p.orbitAchieved, true, `${id} did not reach orbit`);
  assert.ok(at12.groundDistanceM < 10 && at12.altitudeM < 1000, `${id} has an implausible initial climb`);
  const orbitSample = physicsSample(p);
  // The historical comparison must sample the same flight time, including
  // post-insertion coasting when the approximation reaches orbit earlier.
  if (id === 'apollo_11') while (p.time < 710) p.advance(1, { throttle: 0 });
  const rows = [...p.trajectory, physicsSample(p)];
  records[vehicle.name] = rows;
  const peak = rows.reduce((best, row) => row.dynamicPressurePa > best.dynamicPressurePa ? row : best);
  summary.push({ id, vehicle: vehicle.name, initialMassKg: rows[0].massKg, at12,
    orbit: orbitSample, measuredPeak: { timeS: peak.simulationTimeS, altitudeM: peak.altitudeM, pressurePa: peak.dynamicPressurePa },
    events: p.events, source: vehicle.source ?? null, assumptions: vehicle.estimates });
  await writeFile(new URL(`${id}.csv`, folder), trajectoryCSV(rows));
}
// Actual Apollo 11 flown checkpoints, not a fabricated acceptance curve.
const apolloPublished = [
  { event: 'Maximum dynamic pressure', timeS: 83, altitudeM: 7.326 * 1852, surfaceSpeedMps: 1653.4 * .3048 },
  { event: 'S-IC / S-II separation', timeS: 162.30, altitudeM: 36.029 * 1852, surfaceSpeedMps: 7882.9 * .3048 },
  { event: 'S-II / S-IVB separation', timeS: 549, altitudeM: 101.175 * 1852, surfaceSpeedMps: 21377 * .3048 },
  { event: 'Earth orbit insertion', timeS: 709.33, altitudeM: 103.176 * 1852, surfaceSpeedMps: 24243.9 * .3048 },
];
const apolloRows = records[launchVehicles.apollo_11.name];
const comparison = apolloPublished.map(reference => {
  const simulated = apolloRows.reduce((best, row) => Math.abs(row.simulationTimeS - reference.timeS) < Math.abs(best.simulationTimeS - reference.timeS) ? row : best);
  return { reference, simulated, altitudeErrorPercent: 100 * (simulated.altitudeM - reference.altitudeM) / reference.altitudeM,
    speedErrorPercent: 100 * (simulated.surfaceSpeedMps - reference.surfaceSpeedMps) / reference.surfaceSpeedMps };
});
await writeFile(new URL('launch-summary.json', folder), JSON.stringify({ model: '3-DOF rotating-Earth force integration; SI; fixed 1/120 s', summary, historicalComparison: { source: launchSources.apolloFlight, comparison } }, null, 2));
await writeFile(new URL('trajectories.html', folder), trajectoryReport(records, 'JUGRE · launch dynamics verification'));
console.table(summary.map(s => ({ mission: s.id, 'T+12 altitude m': Math.round(s.at12.altitudeM), 'T+12 speed m/s': Math.round(s.at12.surfaceSpeedMps), 'T+12 range m': s.at12.groundDistanceM.toFixed(2), 'orbit time s': Math.round(s.orbit.simulationTimeS), 'perigee km': (s.orbit.periapsisM/1000).toFixed(1), 'apogee km': (s.orbit.apoapsisM/1000).toFixed(1) })));
console.log('Recorded trajectories, source comparison and verification summary in assembly_hangar/diagnostics.');
