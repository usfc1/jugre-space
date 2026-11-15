import { Quaternion, Vector3 } from 'three';
import { assistanceLevels, controlProfiles } from './control-profiles.mjs';
import { inputBlockReason } from './flight-controls.mjs';

function navball(canvas) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 2;
  const image = ctx.createImageData(size, size);
  const sphere = [];
  for (let y = 1; y < size; y++) for (let x = 1; x < size; x++) {
    const sx = (x + .5 - center) / radius;
    const sy = (center - y - .5) / radius;
    const z2 = 1 - sx * sx - sy * sy;
    if (z2 >= 0) sphere.push([4 * (y * size + x), sx, sy, Math.sqrt(z2)]);
  }
  const inverse = new Quaternion(), up = new Vector3(), velocity = new Vector3(), forecast = new Vector3();
  const horizon = [220, 222, 207], sky = [65, 138, 183], ground = [163, 106, 66];
  const projected = (v, forwardZ) => [v.x, forwardZ ? v.y : -v.z, forwardZ ? v.z : v.y];
  const point = ([x, y]) => [center + x * radius, center - y * radius];
  let previous;

  function marker(vector, color, retrograde) {
    const [x, y, depth] = vector;
    const [px, py] = point(vector);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.globalAlpha = depth < -.02 ? .5 : 1;
    ctx.beginPath(); ctx.arc(px, py, 4, 0, 2 * Math.PI);
    ctx.moveTo(px - 7, py); ctx.lineTo(px - 4, py);
    ctx.moveTo(px + 4, py); ctx.lineTo(px + 7, py);
    if (retrograde) {
      ctx.moveTo(px - 2, py - 2); ctx.lineTo(px + 2, py + 2);
      ctx.moveTo(px - 2, py + 2); ctx.lineTo(px + 2, py - 2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  return ({ attitude, radial, motion, acceleration, forwardZ }, showPrediction) => {
    inverse.copy(attitude).invert();
    const [ux, uy, uz] = projected(up.copy(radial).normalize().applyQuaternion(inverse), forwardZ);
    velocity.copy(motion).applyQuaternion(inverse);
    forecast.copy(motion).addScaledVector(acceleration, 8).applyQuaternion(inverse).normalize();
    const hasMotion = velocity.lengthSq() > 1e-8;
    const direction = projected(velocity.normalize(), forwardZ);
    const prediction = showPrediction && hasMotion ? projected(forecast, forwardZ) : null;
    const key = [ux, uy, uz, ...direction, ...(prediction ?? []), hasMotion].join(',');
    if (key === previous) return;
    previous = key;
    for (const [i, x, y, z] of sphere) {
      const side = ux * x + uy * y + uz * z;
      const shade = .56 + .44 * z;
      const color = Math.abs(side) < .025 ? horizon : side > 0 ? sky : ground;
      image.data[i] = color[0] * shade;
      image.data[i + 1] = color[1] * shade;
      image.data[i + 2] = color[2] * shade;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    if (prediction) {
      ctx.beginPath(); ctx.setLineDash([2, 3]); ctx.strokeStyle = '#fff0a0'; ctx.lineWidth = 1.4;
      ctx.moveTo(...point(direction)); ctx.lineTo(...point(prediction)); ctx.stroke(); ctx.setLineDash([]);
    }
    if (hasMotion) {
      const reverse = direction.map(n => -n);
      marker(reverse, '#ffc38f', true);
      marker(direction, '#a9ffba', false);
    }
    ctx.beginPath(); ctx.strokeStyle = '#fff4d8'; ctx.lineWidth = 1.3;
    ctx.moveTo(center - 10, center); ctx.lineTo(center - 3, center);
    ctx.moveTo(center + 3, center); ctx.lineTo(center + 10, center);
    ctx.moveTo(center, center + 3); ctx.lineTo(center, center + 7); ctx.stroke();
  };
}

export function setupManualControlView(panel, { toggle, setAssistance }) {
  const button = panel.querySelector('#flight-take-control');
  const profileText = panel.querySelector('#flight-control-profile');
  const assist = panel.querySelector('#flight-assistance');
  const drawNavball = navball(panel.querySelector('#flight-navball'));
  button.addEventListener('click', toggle);
  assist.addEventListener('change', () => setAssistance(assist.value));
  return {
    update(state, context, rate, orientation) {
      const { profile, owner } = context;
      const manual = state.mode === 'manual' && Boolean(owner);
      const assistance = assistanceLevels[state.manualControl.assistance];
      profileText.textContent = manual ? 'Manual' : 'Autopilot';
      profileText.title = controlProfiles[profile].label;
      button.textContent = manual ? 'Autopilot' : 'Take control';
      button.disabled = !owner || rate > 1 && state.flightLength !== 'short';
      button.title = context.reason || inputBlockReason(state, context, rate) || '';
      assist.value = state.manualControl.assistance;
      if (controlProfiles[profile].widgets.includes('navball')) {
        drawNavball(orientation, assistance.prediction && Boolean(owner));
      }
    },
  };
}
