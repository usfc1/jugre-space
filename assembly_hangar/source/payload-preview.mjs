import { AnimationMixer, LoopOnce, MathUtils } from 'three';
import { setPayloadDeployment } from './payload-configuration.mjs';

export function clipPose(model, clip) {
  const mixer = new AnimationMixer(model);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1).play();
  action.paused = true;
  return (progress) => {
    action.time = clip.duration * progress;
    mixer.update(0);
  };
}

export function setupPayloadPreview(clips, announce, unload, inspect) {
  const panel = document.querySelector('#payload-systems');
  const select = document.querySelector('#systems-part');
  const detail = document.querySelector('#systems-detail');
  const hatch = document.querySelector('#systems-hatch');
  const release = document.querySelector('#systems-release');
  const remove = document.querySelector('#systems-unload');
  let systems = new Map();
  const selected = () => systems.get(select.value);

  function render() {
    const item = selected();
    panel.hidden = !item;
    if (!item) return;
    const bay = item.piece.spec.system === 'bay';
    release.hidden = !item.cargo;
    remove.hidden = !item.cargo;
    if (!bay) {
      hatch.textContent = item.open ? 'Close cabin' : 'Open cabin';
      hatch.disabled = false;
      detail.textContent = '2 seats · flight controls';
      return;
    }
    hatch.disabled = item.out || item.travel > 0;
    hatch.textContent = item.open ? 'Close bay' : 'Open bay';
    release.textContent = item.out ? 'Restow' : 'Test deployment';
    remove.disabled = hatch.disabled;
    const state = item.travel === 1 && item.out ? 'deployed' : item.out || item.travel > 0 ? 'deploying' : 'stowed';
    detail.textContent = item.cargo ? `${item.cargo.spec.name} · ${state}` : 'Empty · drag a payload here';
  }

  select.addEventListener('change', render);
  hatch.addEventListener('click', () => {
    const item = selected();
    item.open = !item.open;
    if (item.exterior) {
      item.exterior.visible = !item.open;
      if (item.open) inspect(item.piece, 'crew');
      announce(item.open ? 'Cabin open.' : 'Cabin closed.');
    } else {
      announce(item.open ? 'Bay opening.' : 'Bay closing.');
    }
    render();
  });
  release.addEventListener('click', () => {
    const item = selected();
    item.open = true;
    item.out = !item.out;
    if (item.out) inspect(item.piece, 'bay', item.cargo.spec.releaseM);
    announce(item.out ? 'Testing deployment.' : 'Restowing payload.');
    render();
  });
  remove.addEventListener('click', () => unload(selected().cargo.entry.key));

  return {
    load(pieces) {
      const previous = select.value;
      systems = new Map();
      const options = [];
      for (const piece of pieces.values()) {
        const { key, part } = piece.entry;
        const kind = piece.spec.system;
        if (kind !== 'bay' && kind !== 'crew') continue;
        const item = { piece, open: kind === 'bay', doors: kind === 'bay' ? 1 : 0, out: false, travel: 0 };
        if (kind === 'bay') {
          item.doorPose = clipPose(piece.visual, clips.get(part));
          item.doorPose(1);
          item.cargo = [...pieces.values()].find(({ entry, spec }) => entry.parent === key && spec.system === 'payload');
          if (item.cargo) {
            const cargoClip = clipPose(item.cargo.visual, clips.get(item.cargo.entry.part));
            item.cargoPose = progress => { cargoClip(progress); setPayloadDeployment(item.cargo.visual, progress); };
            item.cargoPose(0);
          }
        } else {
          piece.visual.traverse((child) => {
            if (child.userData.role === 'crewExterior') item.exterior = child;
          });
        }
        systems.set(key, item);
        const text = `${piece.spec.code} · ${kind === 'bay' ? 'Cargo bay' : 'Cabin'}`;
        options.push(new Option(text, key));
      }
      select.replaceChildren(...options);
      if (systems.has(previous)) select.value = previous;
      render();
    },
    openBays() {
      for (const item of systems.values()) {
        if (item.doorPose) item.open = true;
      }
      render();
    },
    isReleasing() {
      return [...systems.values()].some((item) => item.out || item.travel > 0);
    },
    update(dt) {
      for (const item of systems.values()) {
        if (!item.doorPose) continue;
        const doors = MathUtils.clamp(item.doors + (item.open ? 1 : -1) * dt * 1.65, 0, 1);
        if (item.doors !== doors) item.doorPose(doors);
        item.doors = doors;
        if (!item.cargo || (item.out && doors < 1)) continue;
        const travel = MathUtils.clamp(item.travel + (item.out ? 1 : -1) * dt / 2.4, 0, 1);
        if (travel === item.travel) continue;
        const rail = MathUtils.smoothstep(travel, 0, 0.53);
        // Visual-only motion in the bay's frame leaves both saved ports untouched.
        item.cargo.visual.position.set(-rail * item.cargo.spec.releaseM, 0, 0)
          .applyQuaternion(item.cargo.object.quaternion.clone().invert());
        item.cargoPose(MathUtils.smoothstep(travel, 0.53, 1));
        item.travel = travel;
        if (travel === 0 || travel === 1) render();
      }
    },
  };
}
