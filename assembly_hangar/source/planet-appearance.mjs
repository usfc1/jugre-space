import { CanvasTexture, SRGBColorSpace } from 'three';
import { planets } from './mission-planets.mjs';

// Schematic offline planet maps. Existing photographic maps take precedence.
export function schematicPlanetMap(id) {
  const body = planets[id];
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = body.color;
  context.fillRect(0, 0, 512, 256);
  for (let y = 0; y < 256; y++) {
    const shade = Math.sin(y * .24) * .035 + Math.sin(y * .071) * .055;
    context.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
    context.fillRect(0, y, 512, 1);
  }
  if (id === 'mercury') for (let i = 0; i < 160; i++) {
    const x = (i * 137.51) % 512, y = (i * 53.73) % 256, radius = 2 + i % 11;
    context.strokeStyle = '#524b4540';
    context.fillStyle = '#ffffff0b';
    context.beginPath(); context.ellipse(x, y, radius * 1.5, radius, 0, 0, Math.PI * 2); context.fill(); context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
