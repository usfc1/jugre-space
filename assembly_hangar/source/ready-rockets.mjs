import { Box3, Vector3 } from 'three';
import { placeOnDeck } from './vab-layout.mjs';

const storageKey = 'jugre.assembly-hangar.ready-rocket.v1';
const meters = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function fitOnStand(model, { min, max }) {
  const bounds = placeOnDeck(model, new Box3(new Vector3(...min), new Vector3(...max)), undefined, true);
  model.name = 'vab_ready_rocket';
  model.traverse((item) => {
    if (item.isMesh) item.castShadow = item.receiveShadow = true;
  });

  return { group: model, bounds };
}

export function setupReadyRockets({ scene, rockets, decode, load, onDisplay }) {
  const area = document.querySelector('#work-area');
  const panel = document.querySelector('#ready-rockets');
  const list = document.querySelector('#ready-list');
  const vehicle = document.querySelector('#ready-vehicle');
  const payload = document.querySelector('#ready-payload');
  const length = document.querySelector('#ready-length');
  const download = document.querySelector('#ready-download');
  const status = document.querySelector('#ready-status');
  const cache = new Map();
  let selected = rockets[0];
  let displayed;
  let visible = false;
  let request = 0;
  try {
    selected = rockets.find(({ id }) => id === localStorage.getItem(storageKey)) ?? selected;
  } catch { /* Start with Apollo 11 when storage is unavailable. */ }

  const bytesFor = (id) => decode(document.getElementById(`rocket-data-${id}`).textContent);

  function loadOnce(spec) {
    if (!cache.has(spec.id)) {
      const loading = load(bytesFor(spec.id)).then(({ scene: model }) => fitOnStand(model, spec.bounds))
        .catch((error) => {
          cache.delete(spec.id);
          throw error;
        });
      cache.set(spec.id, loading);
    }
    return cache.get(spec.id);
  }

  async function select(spec) {
    selected = spec;
    const token = ++request;
    const height = spec.bounds.max[1] - spec.bounds.min[1];
    for (const button of list.children) button.setAttribute('aria-pressed', String(button.dataset.rocket === spec.id));
    vehicle.textContent = spec.launcher;
    payload.textContent = spec.payload;
    length.textContent = `${meters.format(height)}  m`;
    if (displayed?.id === spec.id) {
      status.textContent = 'On the stand';
      download.disabled = false;
      if (visible) onDisplay(displayed.bounds);
      return;
    }
    displayed?.group.removeFromParent();
    displayed = undefined;
    download.disabled = true;
    status.textContent = 'Loading vehicle…';
    try {
      const { group, bounds } = await loadOnce(spec);
      if (token !== request) return;
      displayed = { id: spec.id, group, bounds };
      group.visible = visible;
      scene.add(group);
      status.textContent = 'On the stand';
      download.disabled = false;
      if (visible) onDisplay(bounds);
      try { localStorage.setItem(storageKey, spec.id); } catch { /* The current selection is still available. */ }
    } catch (error) {
      if (token !== request) return;
      console.error(error);
      status.textContent = 'Model unavailable. Select it again.';
    }
  }

  for (const spec of rockets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ready-card';
    button.dataset.rocket = spec.id;
    button.setAttribute('aria-pressed', 'false');
    const info = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = spec.name;
    const launcher = document.createElement('small');
    launcher.textContent = spec.launcher;
    info.append(name, launcher);
    button.append(info);
    button.addEventListener('click', () => select(spec));
    list.append(button);
  }
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([bytesFor(selected.id)], { type: 'model/gltf-binary' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = selected.file.split('/').at(-1);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
  return {
    select(id) {
      const spec = rockets.find((rocket) => rocket.id === id);
      if (spec) return select(spec);
    },
    setEnabled(active) {
      const entering = active && !visible;
      visible = active;
      area.classList.toggle('ready', active);
      panel.hidden = !active;
      if (displayed) displayed.group.visible = active;
      if (entering) select(selected);
    },
  };
}
