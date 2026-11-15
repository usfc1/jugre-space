import { Vector3 } from 'three';

const sun = new Vector3(.65, .35, .68).normalize();
const offset = new Vector3();

export function crewGenerationFactor(position, moon, earthRadius, moonRadius) {
  const inShadow = (vector, radius) => {
    const along = vector.dot(sun);
    return along < 0 && vector.lengthSq() - along * along < radius * radius;
  };
  return inShadow(position, earthRadius) || inShadow(offset.copy(position).sub(moon), moonRadius) ? 0 : 1;
}

