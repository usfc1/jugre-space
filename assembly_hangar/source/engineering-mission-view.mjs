const steps = [
  { name: 'Mission', title: 'Mission setup', description: '', tip: 'Presets', help: 'Pick a preset to fill in the form.' },
  { name: 'Orbit', title: 'Target orbit', description: '', tip: 'Orbit shape', help: 'Equal altitudes define a circular orbit.' },
  { name: 'Payload', title: 'Payload', description: '', tip: 'Onboard systems', help: 'Set equipment and supplies below.' },
  { name: 'Launcher', title: 'Launcher', description: '', tip: 'Assembly', help: 'Use the catalog or your hangar build.' },
  { name: 'Review', title: 'Mission review', description: '', tip: 'Preflight', help: 'Recalculate after editing the mission.' },
];

export function setupEngineeringMissionView({ field, fmt }) {
  const get = id => document.getElementById(id);
  const root = get('engineering-mode');
  const main = root.querySelector('.engineering-main');
  let step = 0;
  let candidate = null;
  let busy = false;
  const nav = get('engineering-steps');
  const tabs = steps.map((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', item.name);
    const number = document.createElement('span');
    number.setAttribute('aria-hidden', 'true');
    button.append(number, document.createTextNode(item.name));
    button.addEventListener('click', () => go(index));
    nav.append(button);
    return button;
  });

  function go(index, focus = true) {
    step = Math.max(0, Math.min(steps.length - 1, index));
    for (const panel of root.querySelectorAll('[data-engineering-step]')) panel.hidden = Number(panel.dataset.engineeringStep) !== step;
    for (const [index, button] of tabs.entries()) {
      if (index === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      button.dataset.done = String(index < step);
      button.firstElementChild.textContent = index < step ? '✓' : String(index + 1);
    }
    const item = steps[step];
    get('engineering-title').textContent = item.title;
    get('engineering-subtitle').textContent = item.description;
    get('engineering-tip-title').textContent = item.tip;
    get('engineering-tip').textContent = item.help;
    get('engineering-back').textContent = step ? '← Back' : 'My projects';
    main.scrollTop = 0;
    root.querySelector('.engineering-layout').scrollTop = 0;
    update();
    if (focus) get('engineering-title').focus({ preventScroll: true });
  }

  function update(state = {}) {
    if ('candidate' in state) candidate = state.candidate;
    if ('busy' in state) busy = state.busy;
    const label = name => field(name).selectedOptions[0]?.textContent ?? '—';
    const number = name => field(name).value === '' ? null : field(name).valueAsNumber;
    const metric = (name, unit) => number(name) == null ? 'Unset' : `${fmt(number(name))} ${unit}`;
    get('engineering-summary-name').textContent = field('name').value.trim() || 'New mission';
    const route = get('engineering-route');
    route.replaceChildren();
    for (const [index, name] of ['origin', 'destination'].entries()) {
      const part = document.createElement('span');
      part.textContent = label(name);
      if (index) {
        const arrow = document.createElement('span');
        arrow.className = 'standard-route-arrow';
        arrow.textContent = '→';
        arrow.setAttribute('aria-hidden', 'true');
        route.append(arrow);
      }
      route.append(part);
    }
    const values = get('engineering-summary-values');
    values.replaceChildren();
    const orbit = number('periapsisKm') == null || number('apoapsisKm') == null ? 'Unset'
      : `${fmt(number('periapsisKm'))} × ${fmt(number('apoapsisKm'))} km`;
    for (const [name, value] of [
      ['Objective', label('type')], ['Orbit', orbit], ['Cargo', metric('payloadMassKg', 'kg')],
      ['Crew', number('crewCount') === 0 ? 'Uncrewed' : metric('crewCount', 'people')],
      ['Assembly', label('assembly')],
    ]) {
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = name;
      detail.textContent = value;
      values.append(term, detail);
    }
    get('engineering-assembly-hint').textContent = field('assembly').value === 'manual'
      ? 'Using your hangar build.'
      : 'Using the parts catalog.';
    get('engineering-next').hidden = step === 4;
    get('engineering-calculate').hidden = step !== 4 || Boolean(candidate) && !busy;
    get('engineering-calculate').disabled = busy;
    get('engineering-calculate').textContent = busy ? 'Calculating…' : 'Calculate';
    get('engineering-recalculate').hidden = !candidate || busy;
    get('engineering-results').hidden = !candidate;
    get('engineering-empty').hidden = Boolean(candidate);
    get('engineering-empty').textContent = busy ? 'Checking launcher options…'
      : 'Calculate to review launcher options.';
    get('design-cancel').hidden = !busy;
    get('design-apply').hidden = step !== 4 || !candidate || busy;
    root.dispatchEvent(new CustomEvent('engineering-preview-change', { bubbles: true }));
  }

  get('engineering-back').addEventListener('click', () => {
    if (step) go(step - 1);
    else {
      get('design-library').open = !get('design-library').open;
      if (get('design-library').open) get('design-library').scrollIntoView({ block: 'nearest' });
    }
  });
  get('engineering-next').addEventListener('click', () => go(step + 1));
  return { go, update, get step() { return step; } };
}
