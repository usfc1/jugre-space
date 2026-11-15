import { Quaternion, Vector3 } from 'three';
import { resolveAssembly } from './assembly.mjs';
import { payloadMass } from './payload-configuration.mjs';

export function inspectRocket(layout, specs) {
  const orientations = new Map();
  const byKey = new Map();
  const stages = [];
  const problems = [];
  for (const { entry, pose, spec } of resolveAssembly(layout, specs).values()) {
    const local = pose?.rotation ?? new Quaternion();
    const orientation = (orientations.get(entry.parent)?.clone() ?? new Quaternion()).multiply(local);
    const parent = byKey.get(entry.parent);
    const parentSpec = parent && specs.get(parent.part);
    const axial = new Vector3(0, 1, 0).applyQuaternion(orientation).y > .999;
    const boundary = parent?.stats.staging === 'integratedInterstage' && ['mount_forward', 'mount_engine'].includes(entry.socket);
    const index = (parent?.stage ?? 0) + Number(boundary);
    const component = { ...entry, stage: index, axial, orientation: local.toArray(), massKg: payloadMass(spec, entry.spacecraft) ?? null,
      stats: spec.stats ?? {}, system: spec.system ?? null };
    const bucket = stages[index] ??= { index, components: [], engines: [], tanks: [], boundaries: [] };
    bucket.components.push(entry.key);
    byKey.set(entry.key, component);
    orientations.set(entry.key, orientation);
    const { staging, propellant, thrustKN, capacityKg } = component.stats;
    if (staging === 'integratedInterstage') {
      bucket.boundaries.push(entry.key);
      const lower = parentSpec?.mounts.get(entry.socket);
      const lowerAxis = lower && new Vector3(0, 0, 1).applyQuaternion(lower.rotation).applyQuaternion(orientations.get(parent.key));
      if (!axial || entry.plug !== 'mount_aft' || !(lowerAxis?.y > .999) || parent?.stats.staging === 'integratedInterstage') {
        problems.push(`${entry.key}: place the interstage above the lower stage on mount_aft.`);
      }
    } else if (['axialSeparation', 'radialSeparation'].includes(staging)) {
      problems.push(`${entry.key}: controlled separation requires IS-125 or IS-250.`);
    }
    if (propellant !== 'kerolox') continue;
    if (!axial) problems.push(`${entry.key}: kerolox engine or tank is off-axis.`);
    if (thrustKN) bucket.engines.push(entry.key);
    if (capacityKg > 0) bucket.tanks.push(entry.key);
  }
  const staged = stages.some(stage => stage.boundaries.length);
  if (staged) {
    for (const stage of stages) {
      const boundary = stage.boundaries[0];
      if (stage.boundaries.length > 1 || (boundary && !stages[stage.index + 1])) problems.push(`Stage ${stage.index + 1}: requires one interstage and a complete upper stage.`);
      if (!stage.engines.length || !stage.tanks.length) problems.push(`Stage ${stage.index + 1}: requires its own engines and tanks.`);
      const interstage = stages[stage.index - 1]?.boundaries[0];
      if (interstage && (!stage.engines.some(key => byKey.get(key).parent === interstage && byKey.get(key).socket === 'mount_engine')
        || !stage.tanks.some(key => byKey.get(key).parent === interstage && byKey.get(key).socket === 'mount_forward'))) {
        problems.push(`Stage ${stage.index + 1}: mount the engine and tank on the lower interstage.`);
      }
      if (stage.index === stages.length - 1) continue;
      if (stage.components.some(key => {
        const { stats, system, part } = byKey.get(key);
        return stats.crewSeats || stats.maxPayloadMassKg || system === 'payload' || system === 'bay' || part === 'pb_1_strizh';
      })) problems.push(`Stage ${stage.index + 1}: place control, cabin, and payload on the upper stage.`);
    }
  }
  return { components: [...byKey.values()], stages, problems, staged };
}
