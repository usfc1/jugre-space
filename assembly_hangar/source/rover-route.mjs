const spacing = 1;
const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
export function roverRoute(start, goal, blocked) {
  const origin = [Math.round(start.x / spacing), Math.round(start.z / spacing)];
  const target = [Math.round(goal[0] / spacing), Math.round(goal[2] / spacing)];
  const key = ([x, z]) => x + ',' + z;
  const distance = ([x, z]) => Math.hypot(target[0] - x, target[1] - z);
  const open = [{ point: origin, cost: 0, priority: distance(origin), parent: null }];
  const known = new Map([[key(origin), 0]]);
  while (open.length && known.size < 12000) {
    open.sort((a, b) => b.priority - a.priority);
    const entry = open.pop();
    if (entry.cost > known.get(key(entry.point))) continue;
    if (distance(entry.point) <= .1) {
      const route = [];
      for (let node = entry; node.parent; node = node.parent) route.push([node.point[0] * spacing, node.point[1] * spacing]);
      return route.reverse();
    }
    for (const [dx, dz] of neighbors) {
      const next = [entry.point[0] + dx, entry.point[1] + dz];
      if (Math.abs(next[0] - origin[0]) > 100 || Math.abs(next[1] - origin[1]) > 100) continue;
      const cost = entry.cost + Math.hypot(dx, dz), id = key(next);
      if (cost >= (known.get(id) ?? Infinity) || blocked(next[0] * spacing, next[1] * spacing)) continue;
      if (dx && dz && (blocked(next[0] * spacing, entry.point[1] * spacing) || blocked(entry.point[0] * spacing, next[1] * spacing))) continue;
      known.set(id, cost); open.push({ point: next, cost, priority: cost + distance(next), parent: entry });
    }
  }
  return [];
}
