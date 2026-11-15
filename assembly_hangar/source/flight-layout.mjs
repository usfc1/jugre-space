import { Box3, Group, MathUtils, Vector3 } from 'three';

export function findPart(root, id) {
  let match;
  root?.traverse((part) => {
    const partId = part.userData.partId ?? part.name;
    if (!match && (partId === id || partId?.endsWith(`.${id}`))) match = part;
  });
  return match;
}

export function dockingPort(root) {
  const port = findPart(root, 'dock_port');
  root.updateWorldMatrix(true, true);
  return port ? port.getWorldPosition(new Vector3()) : new Box3().setFromObject(root).getCenter(new Vector3());
}

// Measure both anchors before writing the moving root. Writing position first
// changes getWorldPosition() of its own port and subtracts the destination twice.
export function alignDockingPorts(moving, fixed, offset = new Vector3()) {
  const source = dockingPort(moving), destination = dockingPort(fixed).add(offset);
  const parent = moving.parent;
  if (parent) { parent.worldToLocal(source); parent.worldToLocal(destination); }
  moving.position.add(destination.sub(source));
}

// Both ports meet in metres in the local ship scene. Columbia remains in orbit
// during the climb and only enters the close camera during the final approach.
export function positionColumbia(nearby, visual, progress) {
  nearby.visible = progress >= 0.78;
  if (!nearby.children.length || !visual) return;
  const approach = MathUtils.smoothstep(progress, 0.78, .95);
  nearby.position.set(0, 0, 0);
  nearby.rotation.set(Math.PI, 0, 0);
  const destination = dockingPort(visual);
  const source = dockingPort(nearby);
  const remaining=1-approach;
  const distance=Math.hypot(65*remaining,500*remaining**2),lateral=65*remaining**2;
  nearby.position.copy(destination).sub(source)
    .add(new Vector3(lateral,Math.sqrt(Math.max(0,distance*distance-lateral*lateral)),0));
}

export function splitEagle(root) {
  const descent = findPart(root, 'eagle_descent');
  const surface = new Group();
  if (descent) {
    root.updateWorldMatrix(true, true);
    surface.attach(descent);
  }
  const center = new Box3().setFromObject(root, true).getCenter(new Vector3());
  surface.position.sub(center);
  const groundY = new Box3().setFromObject(surface, true).min.y;
  return { surface, groundY };
}
