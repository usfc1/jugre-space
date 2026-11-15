import { Box3, Group, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { dockingPort, findPart } from './flight-layout.mjs';

export const orbitalPayloads = {
  apollo_docked: ['columbia_csm', 'eagle_lm'],
  orion: ['orion_esm', 'orion_cma', 'orion_cm'],
  mars2020_ship: ['perseverance_spacecraft'],
  msl_ship: ['curiosity_spacecraft'],
  dart: ['dart'],
  voyager: ['voyager_2'],
  dragon: ['cargo_dragon_2'],
};
export const fairingParts = [
  'sla', 'launch_escape', 'orion_las', 'esm_fairing_01', 'esm_fairing_02', 'esm_fairing_03',
  'atlas_v_fairing_l', 'atlas_v_fairing_r', 'falcon9_fairing_l', 'falcon9_fairing_r',
  'titan_centaur_fairing_l', 'titan_centaur_fairing_r',
];

const up = new Vector3(0, 1, 0);
const pitch = new Vector3(1, 0, 0);
const ease = MathUtils.smoothstep;

export function finishSkippedManeuver(action) {
  // Give contact checks two adjacent endpoint samples rather than measuring a
  // teleport from the current pose as a high-speed docking collision.
  if (action.duration > 0 && action.time < action.duration) {
    action.pose(Math.max(action.time / action.duration, 1 - Math.min(.1, action.duration) / action.duration));
  }
  action.time = action.duration;
  action.pose(1);
  action.finish();
}

export function captureParts(parent, model, ids) {
  const parts = ids.map(id => findPart(model, id));
  if (!parts.length || parts.some(part => !part)) return null;
  if (parts.length === 1) {
    parent.attach(parts[0]);
    return parts[0];
  }
  const group = new Group();
  parent.add(group);
  for (const part of parts) group.attach(part);
  return group;
}

export function captureAssemblyStage(parent, model, droppedKeys, retainedKeys) {
  const pieces = new Map();
  model.traverse(node => { if (node.userData.assemblyKey) pieces.set(node.userData.assemblyKey, node); });
  const dropped = new Set(droppedKeys);
  for (const key of retainedKeys) {
    const piece = pieces.get(key);
    if (piece && dropped.has(piece.parent?.userData.assemblyKey)) model.attach(piece);
  }
  const group = new Group();
  parent.add(group);
  for (const key of droppedKeys) {
    const piece = pieces.get(key);
    if (piece && !dropped.has(piece.parent?.userData.assemblyKey)) group.attach(piece);
  }
  if (group.children.length) return group;
  group.removeFromParent();
  return null;
}

export function relativeBounds(model, reference) {
  model.updateWorldMatrix(true, true);
  const inverse = reference.matrixWorld.clone().invert();
  const matrix = new Matrix4();
  const result = new Box3();
  model.traverse(node => {
    if (!node.isMesh) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    result.union(node.geometry.boundingBox.clone().applyMatrix4(matrix.multiplyMatrices(inverse, node.matrixWorld)));
  });
  return result;
}

export function createDepartures(scene, getPhysics) {
  return {
    release(...args) { return getPhysics()?.release(...args) ?? false; },
    reset() { getPhysics()?.reset(); },
  };
}
export function apolloTransposition(payload) {
  const csm = findPart(payload, 'columbia_csm');
  const eagle = findPart(payload, 'eagle_lm');
  const start = csm.position.clone();
  const attitude = csm.quaternion.clone();
  const turn = new Quaternion();
  const offset = new Vector3();
  return (p) => {
    csm.position.copy(start).addScaledVector(up, 13 * ease(p, 0, .42));
    csm.quaternion.copy(attitude).multiply(turn.setFromAxisAngle(pitch, Math.PI * ease(p, .24, .64)));
    if (p > .64) {
      offset.copy(payload.worldToLocal(dockingPort(eagle))).sub(payload.worldToLocal(dockingPort(csm)));
      csm.position.addScaledVector(offset, ease(p, .64, 1));
    }
  };
}

export function deploymentPose(payload, deployed) {
  const targets = new Map();
  const joints = [];
  deployed?.traverse(node => {
    const id = node.userData.partId;
    if (id && /wing_\d+$|\.deployment$|^voyager_(mag_boom|rtg_boom|radio_antennas)$/.test(id)) targets.set(id, node.quaternion);
  });
  payload.traverse(node => {
    const target = targets.get(node.userData.partId);
    if (target && node.quaternion.angleTo(target) > .005) joints.push({ node, start: node.quaternion.clone(), target });
  });
  return p => {
    const angle = ease(p, .25, 1);
    for (const { node, start, target } of joints) node.quaternion.slerpQuaternions(start, target, angle);
  };
}

