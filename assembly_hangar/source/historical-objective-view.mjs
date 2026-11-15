import { missionBriefing } from './historical-objectives.mjs';
const labels = { ACTIVE: 'Pending', LOCKED: 'Pending', COMPLETED: 'Complete', SKIPPED: 'Skipped', FAILED: 'Failed' };
export function setupHistoricalObjectives(panel, getState, retry) {
  const briefing = document.createElement('p'); briefing.id = 'mission-briefing'; briefing.className = 'flight-key-hint';
  const rocket = document.querySelector('#launch-rocket');
  const options = document.querySelector('#launch-objective-options');
  const tasks = document.createElement('label'); tasks.innerHTML = '<input id="launch-historical-tasks" type="checkbox"> Training objectives'; options.append(tasks, briefing);
  const brief = () => { briefing.textContent = missionBriefing(rocket.value); }; rocket.addEventListener('change', brief); brief();
  const section = document.createElement('details'); section.id = 'historical-objectives';
  section.innerHTML = '<summary>Mission objectives</summary><output id="mission-result"></output><label><input id="historical-burn-manual" type="checkbox"> Manual burn</label><label>Main engine throttle <input id="historical-burn-throttle" type="range" min="0" max="100" value="100"></label><output id="historical-burn-readings"></output><ol id="mission-objective-list"></ol><button type="button" id="mission-retry-stage">Retry phase</button>';
  panel.append(section); section.querySelector('#mission-retry-stage').onclick = retry;
  const instruments = document.createElement('div');
  instruments.innerHTML = '<label>Target <select id="historical-photo-target"></select></label><button type="button" id="historical-photo">Capture frame</button><label>Cross-track correction, m/s <input id="historical-cruise-dv" type="number" step="0.01" value="0"></label><button type="button" id="historical-correct">Apply correction</button><output id="historical-cruise"></output>';
  section.querySelector('ol').before(instruments);
  const dartPanel = document.createElement('div');
  dartPanel.innerHTML = '<output></output><label>DRACO target <select><option value="didymos">Didymos</option><option value="dimorphos">Dimorphos</option></select></label><label>X m/s <input type="number" step="0.001" value="0"></label><label>Y m/s <input type="number" step="0.001" value="0"></label><button type="button">RCS burn</button>';
  section.querySelector('ol').before(dartPanel);
  const operations = document.createElement('div');
  operations.innerHTML = '<button type="button" id="voyager-slow-platform">Slow Voyager platform</button><button type="button" id="dragon-unload">Unload cargo</button><button type="button" id="dragon-load">Stow samples</button><output></output>';
  const phaseBurn = document.createElement('button'); phaseBurn.type = 'button'; phaseBurn.textContent = 'Dragon phasing burn · 12 m/s'; operations.prepend(phaseBurn);
  section.querySelector('ol').before(operations);
  const select = instruments.querySelector('select'), photo = instruments.querySelector('#historical-photo'), correct = instruments.querySelector('#historical-correct');
  const canAct = s => s?.objectivesEnabled && !s.paused && !s.failed && !s.complete && s.mode === 'manual' && s.actualRate <= 1;
  phaseBurn.onclick = () => { const s = getState(); if (canAct(s)) s.historicalOperations.dragonPhasing(s, 12); };
  operations.querySelector('#voyager-slow-platform').onclick = () => { const s = getState(); if (canAct(s)) s.historicalOperations.platformRate = .2; };
  operations.querySelector('#dragon-unload').onclick = () => { const s = getState(); if (canAct(s)) s.historicalOperations.transferCargo(s, false); };
  operations.querySelector('#dragon-load').onclick = () => { const s = getState(); if (canAct(s)) s.historicalOperations.transferCargo(s, true); };
  dartPanel.querySelector('select').onchange = event => {
    const s = getState(), ops = s?.historicalOperations;
    if (canAct(s)) ops.dart.acquire(event.target.value, ops.dartSeconds(s));
  };
  dartPanel.querySelector('button').onclick = () => {
    const s = getState(), ops = s?.historicalOperations;
    if (!canAct(s)) return;
    const [x, y] = [...dartPanel.querySelectorAll('input')].map(input => Number(input.value));
    ops.dart.correct(x, y, ops.dartSeconds(s));
  };
  photo.onclick = () => { const s = getState(); if (canAct(s)) s.historicalOperations.captureInstrument(s, select.value); };
  correct.onclick = () => { const s = getState(); if (canAct(s)) s.historicalOperations.cruiseBurn(s, Number(instruments.querySelector('input').value)); };
  section.querySelector('#historical-burn-manual').onchange = event => {
    const s = getState(); if (s?.historicalOperations && !s.paused && s.actualRate <= 1) s.historicalOperations.manualMotor = event.target.checked;
  };
  section.querySelector('#historical-burn-throttle').oninput = event => {
    const s = getState(); if (s?.historicalOperations && !s.paused && s.mode === 'manual' && s.actualRate <= 1) s.historicalOperations.throttle = Number(event.target.value) / 100;
  };
  let signature = '', recorded = null;
  return { update(storage) {
    const s = getState(), execution = s?.historicalExecution; section.hidden = !execution; if (!execution) return;
    const key = s.id + ':' + execution.objectives.map(o => o.state).join(',');
    const ops = s.historicalOperations, b = ops?.burn;
    const cargo = s.id === 'iss_resupply' && s.kind === 'docking' && s.dockingLocked;
    const phase = s.id === 'iss_resupply' && s.kind === 'orbit';
    const voyager = s.id === 'voyager_2' && s.phaseIndex > 1;
    operations.hidden = !s.objectivesEnabled || !cargo && !voyager && !phase;
    operations.querySelector('#voyager-slow-platform').hidden = !voyager || !ops.flags.platformJammed;
    for (const id of ['dragon-load', 'dragon-unload']) operations.querySelector('#' + id).hidden = !cargo;
    for (const button of operations.querySelectorAll('button')) button.disabled = !canAct(s);
    phaseBurn.hidden = !phase;
    phaseBurn.disabled ||= Boolean(ops.flags.phasing);
    operations.querySelector('output').textContent = cargo
      ? `Delivered ${ops.thermal.unloadedKg}/420 kg · cold cargo ${ops.thermal.returnKg}/36 kg · ${ops.thermal.sampleC.toFixed(1)}°C${ops.thermal.pending ? ' · transfer ' + Math.ceil(ops.thermal.pending.remainingS) + ' s' : ''}`
      : voyager ? `Antenna pointing ${ops.pointingErrorDeg?.toFixed(1) ?? '—'}° · RTG ${ops.sciencePowerW.toFixed(0)} W · downlinked ${ops.downlinkedMB.toFixed(2)} MB` : '';
    const dart = ops?.dart, seconds = dart && ops.dartSeconds(s);
    dartPanel.hidden = !s.objectivesEnabled || !dart || s.kind !== 'dartCruise';
    if (!dartPanel.hidden) {
      dartPanel.querySelector('output').textContent = `DRACO · ${Math.ceil(seconds)} s to encounter · X ${dart.dispersionM.x.toFixed(1)} m / Y ${dart.dispersionM.y.toFixed(1)} m · Δv ${dart.deltaVMps.toFixed(3)}/2 m/s`;
      const dartSelect = dartPanel.querySelector('select'); dartSelect.value = dart.target;
      dartSelect.options[1].disabled = seconds > 3600;
      dartSelect.disabled = !canAct(s) || dart.locked;
      dartPanel.querySelector('button').disabled = dartSelect.disabled || dart.target !== 'dimorphos';
    }
    const targets = ops?.getInstrumentTargets(s) ?? [], c = ops?.cruise;
    if ([...select.options].map(o => o.value).join() !== targets.map(t => t.id).join()) select.replaceChildren(...targets.map(t => new Option(t.label, t.id)));
    instruments.hidden = !s.objectivesEnabled || !targets.length && c?.kind !== s.kind;
    photo.disabled = !canAct(s) || !targets.length;
    correct.disabled = !canAct(s) || c?.kind !== s.kind;
    instruments.querySelector('output').textContent = c?.kind === s.kind
      ? `Target plane · offset ${(c.offsetKm + (s.phase.duration - c.epoch) * c.correctionKmS).toFixed(2)} km · corrections ${c.burns.length}/3 · Δv ${c.dvMps.toFixed(2)}/${c.budgetMps} m/s`
      : `Frames ${ops?.images.length ?? 0} · memory ${ops?.memoryMB.toFixed(1) ?? 0} MB`;
    section.querySelector('#historical-burn-manual').checked = Boolean(ops?.manualMotor);
    section.querySelector('#historical-burn-manual').disabled = !s.objectivesEnabled || s.paused || s.actualRate > 1;
    section.querySelector('#historical-burn-throttle').disabled = !s.objectivesEnabled || s.mode !== 'manual' || s.paused || s.actualRate > 1;
    section.querySelector('#historical-burn-readings').textContent = b ? `${b.phase} · measured Δv ${Math.hypot(...b.delivered).toFixed(1)} m/s · fuel ${ops.fuelKg.toFixed(1)} kg · error ${b.errorFraction == null ? '—' : (b.errorFraction * 100).toFixed(2) + '%'}` : 'Burn pending';
    if (signature !== key) {
      signature = key; const list = section.querySelector('ol'); list.replaceChildren();
      for (const o of execution.objectives) { const li = document.createElement('li'); li.textContent = `[${{ primary: 'P', optional: 'O', bonus: 'B' }[o.tier]}] ${o.name} · ${labels[o.state]}`; list.append(li); }
    }
    const done = execution.objectives.filter(o => o.tier === 'primary' && o.state === 'COMPLETED').length;
    const required = execution.objectives.filter(o => o.tier === 'primary').length;
    const medal = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }[execution.medal(s)];
    const final = s.complete || s.failed;
    section.querySelector('#mission-result').textContent = `Primary ${done}/${required} · medal ${medal ?? 'unawarded'} · time ${s.totalTime.toFixed(0)} s · fuel ${s.fuelMassKg.toFixed(1)} kg`
      + (final ? ` · Max Q ${s.systems.peakPressure.toFixed(1)} kPa · frames ${ops.images.length} · samples ${s.loadedSampleKg ?? 0} kg` : '');
    if ((s.complete || s.failed) && recorded !== s) { execution.saveRecord(s, storage); recorded = s; section.open = true; }
  } };
}
