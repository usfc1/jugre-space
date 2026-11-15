import { MathUtils, Vector3 } from 'three';
import { findPart } from './flight-layout.mjs';
import { deploymentPose } from './flight-maneuvers.mjs';

export function deployDartArrays(payload, deployed, releaseCover) {
  const pose = deploymentPose(payload, deployed);
  const arrays = ['l', 'r'].map(side => {
    const wing = findPart(payload, `dart_rosa_${side}`);
    const rolled = findPart(wing, 'blanket');
    const hinge = findPart(wing, 'deployment');
    const extended = findPart(findPart(deployed, `dart_rosa_${side}`), 'blanket').clone(true);
    const spool = findPart(wing, 'roller');
    hinge.add(extended);
    return { rolled, extended, spool, spoolStart: spool.position.clone() };
  });
  const cover = findPart(findPart(payload, 'dart_draco'), 'cover');
  let uncovered = false;
  return p => {
    pose(Math.min(1, p * 1.8));
    const roll = MathUtils.smoothstep(p, .28, 1);
    for (const { rolled, extended, spool, spoolStart } of arrays) {
      rolled.visible = roll < .06;
      extended.visible = roll > 0;
      extended.scale.z = Math.max(.001, roll);
      const offset = new Vector3(0, 0, 7.98 * roll).applyQuaternion(extended.quaternion);
      spool.position.copy(spoolStart).add(offset);
    }
    if (p > .73 && !uncovered) {
      uncovered = true;
      releaseCover(cover);
    }
  };
}

export function releaseLiciacube(payload, deployedDart, deployedCube) {
  const cube = findPart(payload, 'liciacube');
  const hatch = findPart(findPart(payload, 'dart_liciacube_mount'), 'door');
  const target = findPart(findPart(deployedDart, 'dart_liciacube_mount'), 'door');
  if (!cube || !hatch || !target) throw new Error('DART separation components are missing');
  const hatchStart = hatch.quaternion.clone();
  const start = cube.position.clone();
  const unfold = deploymentPose(cube, deployedCube);
  return p => {
    hatch.quaternion.slerpQuaternions(hatchStart, target.quaternion, MathUtils.smoothstep(p, 0, .24));
    const distance = MathUtils.smoothstep(p, .20, 1);
    cube.position.copy(start).add(new Vector3(.5 * distance, .12 * distance, 3.7 * distance));
    unfold(MathUtils.smoothstep(p, .45, 1));
    cube.rotation.y = -.24 * distance;
  };
}
