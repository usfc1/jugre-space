import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

export const FIRST_STAGE_PARTS = new Set([
  's_ic', 'interstage_1_2', 'sls_core', 'sls_srb_l', 'sls_srb_r', 'lvsa',
  'atlas_v_core', 'atlas_v_srb_01', 'atlas_v_srb_02', 'atlas_v_srb_03', 'atlas_v_srb_04',
  'atlas_v_interstage', 'atlas_v_boattail', 'falcon9_stage_1', 'falcon9_interstage',
  'titan_stage_1', 'titan_srb_l', 'titan_srb_r',
]);

function localBounds(node) {
  const box = new Box3();
  const inverse = node.matrixWorld.clone().invert();
  node.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible) return;
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
  });
  return box;
}

export function activeNozzles(model, activeParts = null) {
  if (!model) return [];
  model.updateWorldMatrix(true, true);
  const inverse = model.matrixWorld.clone().invert();
  const rotation = model.getWorldQuaternion(new Quaternion()).invert();
  const candidates = [];
  model.traverse((node) => {
    const id = node.userData.partId ?? node.name;
    if (!id || !/(^|\.)(bell|nozzle)$/.test(id) || /rcs|draco|vernier|thruster|escape|retrorocket|cold_gas/i.test(id)) return;
    if (activeParts) {
      let active = false;
      for (let owner = node; owner; owner = owner.parent) if (activeParts.some(part => owner.userData.assemblyKey === part
        || owner.userData.partId === part || owner.userData.partId?.endsWith(`.${part}`))) { active = true; break; }
      if (!active) return;
    }
    for (let parent = node; parent; parent = parent.parent) if (!parent.visible) return;
    // Historical models have an engine named "nozzle" containing a bell;
    // Apollo/custom engines use the nozzle itself as the bell node.
    if (node.children.some((child) => /(^|\.)bell$/.test(child.userData.partId ?? child.name))) return;
    const axis = new Vector3(0, -1, 0).applyQuaternion(node.getWorldQuaternion(new Quaternion())).applyQuaternion(rotation);
    if (axis.y > -0.85) return;
    const box = localBounds(node);
    if (box.isEmpty()) return;
    const size = box.getSize(new Vector3());
    const point = box.getCenter(new Vector3()); point.y = box.min.y;
    const at = point.clone().applyMatrix4(node.matrixWorld).applyMatrix4(inverse);
    candidates.push({ id, node, point, radius: Math.max(size.x, size.z) * .5, at });
  });
  if (!candidates.length) return [];
  const lowest = Math.min(...candidates.map(({ at }) => at.y));
  // Only the exposed bottom engine bank burns; upper stages and the payload
  // remain off while they are still carried by the booster.
  return activeParts ? candidates : candidates.filter(({ at, radius }) => at.y <= lowest + Math.max(1.25, radius * 1.5));
}

export function detachFirstStage(model, debris) {
  const parts = [];
  model.traverse((node) => { if (FIRST_STAGE_PARTS.has(node.userData.partId)) parts.push(node); });
  const direction = new Vector3(0, -1, 0).applyQuaternion(model.getWorldQuaternion(new Quaternion()));
  for (const node of parts) { node.updateWorldMatrix(true, false); debris.attach(node); }
  return { parts, direction };
}
