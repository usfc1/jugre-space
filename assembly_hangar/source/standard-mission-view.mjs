import { createMissionPreview } from './mission-preview.mjs';
import { instruments } from './spacecraft-design.mjs';
import { bodyNames, isPlanetaryDestination, nominalTransferS } from './mission-planets.mjs';
import {
  newStandardDraft, prepareStandardMission, readStandardDraft, STANDARD_DRAFT_KEY, standardCargo,
  standardDestinations, standardDraftFromMission, standardGoals, standardMissionSpecification,
} from './standard-mission.mjs';

const stepNames = ['Destination', 'Objective', 'Vehicle', 'Payload', 'Review'];
const fmt = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value) : '—';
const node = (tag, className = '', text = '') => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
};

export function setupStandardMissionDesigner({ engineering, startFlight, previewOptions }) {
  const get = id => document.getElementById(id);
  const dialog = get('mission-designer');
  const choices = get('standard-choices');
  const extra = get('standard-extra');
  const overview = get('standard-overview');
  const flightLength = get('standard-flight-length');
  const problems = get('standard-problems');
  const next = get('standard-next');
  const back = get('standard-back');
  const saveStatus = get('standard-save-status');
  const steps = get('standard-steps');
  const previewTabs = get('standard-preview-tabs');
  const previewError = get('standard-preview-error');
  const previewPanel = dialog.querySelector('.standard-preview');
  const standardLayout = dialog.querySelector('#standard-mode .standard-layout');
  let draft = newStandardDraft();
  let result = null;
  const assemblyButton = node('button', 'control', 'Build in hangar');
  assemblyButton.id = 'standard-open-assembly';
  assemblyButton.type = 'button';
  next.before(assemblyButton);
  assemblyButton.addEventListener('click', () => {
    try {
      const spec = result?.spec ?? standardMissionSpecification(draft);
      window.dispatchEvent(new CustomEvent('jugre-open-assembly', { detail: { spec,
        blueprint: result?.candidate?.blueprint } }));
      dialog.close();
    } catch (error) { warning(error.message); }
  });
  let controller = null;
  let preview = null;
  let dirty = false;
  let launched = false;
  let query = '';
  let previewKind = 'rocket';

  try {
    const saved = localStorage.getItem(STANDARD_DRAFT_KEY);
    if (saved) draft = readStandardDraft(JSON.parse(saved));
  } catch (error) { saveStatus.textContent = error.message; }

  function getPreview() {
    if (!preview) {
      try { preview = createMissionPreview({ ...previewOptions, canvas: get('standard-preview-canvas') }); }
      catch { previewError.textContent = '3D preview unavailable'; }
    }
    return preview;
  }

  function store() {
    try {
      localStorage.setItem(STANDARD_DRAFT_KEY, JSON.stringify(readStandardDraft(draft)));
      saveStatus.textContent = 'Draft saved';
    } catch { saveStatus.textContent = 'Draft saved for this session'; }
  }

  function warning(message, action, label) {
    problems.replaceChildren(node('p', '', message));
    if (action) {
      const button = node('button', '', label);
      button.type = 'button';
      button.addEventListener('click', action);
      problems.append(button);
    }
    problems.hidden = false;
  }

  function invalidate() {
    controller?.abort();
    controller = null;
    result = null;
    dirty = true;
  }

  function image(card, kind, id) {
    const img = node('img');
    img.alt = '';
    card.prepend(img);
    const renderer = getPreview();
    if (renderer) renderer.image(kind, id).then(src => { img.src = src; }).catch(() => { img.hidden = true; });
  }

  function selectCard({ title, description, imageId, imageKind, selected, available = true, onSelect, destination = false }) {
    const card = node('button', 'standard-card');
    card.type = 'button';
    card.setAttribute('aria-pressed', String(selected));
    card.setAttribute('aria-disabled', String(!available));
    if (destination) card.dataset.destination = imageId;
    const content = node('span', 'standard-card-content');
    if (!available) content.append(node('span', 'standard-unavailable', 'Unavailable'));
    content.append(node('strong', '', title), node('p', '', description));
    card.append(node('span', 'standard-card-check', '✓'), content);
    if (imageId) image(card, imageKind, imageId);
    card.addEventListener('click', () => {
      if (!available) { warning(description); return; }
      onSelect();
    });
    return card;
  }

  async function showPreview(kind, id, title, caption) {
    get('standard-preview-title').textContent = title;
    get('standard-preview-caption').textContent = caption;
    previewError.textContent = '';
    try { await getPreview()?.show(kind, id); }
    catch (error) { previewError.textContent = error.message; }
  }

  function showSelectedModel() {
    if (!result?.candidate) return;
    const { candidate, spec } = result;
    for (const button of previewTabs.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.preview === previewKind));
    if (previewKind === 'craft') {
      const id = isPlanetaryDestination(spec.destination) ? 'voyager' : spec.expedition ? 'orion' : spec.spacecraft ? 'science_satellite' : 'dart';
      void showPreview('craft', id, 'Spacecraft', isPlanetaryDestination(spec.destination) ? 'Interplanetary probe' : spec.expedition ? 'Expedition spacecraft · 4 seats' : spec.spacecraft ? 'Mayak satellite' : 'Launcher payload');
    } else if (candidate.blueprint.carrier) {
      void showPreview('rocket', candidate.blueprint.carrier, 'Launcher', candidate.vehicle.name);
    } else {
      get('standard-preview-title').textContent = 'Launcher';
      get('standard-preview-caption').textContent = 'Suggested build';
      try { getPreview()?.showAssembly(candidate.blueprint.layout); }
      catch (error) { previewError.textContent = error.message; }
    }
  }

  let engineeringPreviewKey = '';
  function showEngineeringPreview() {
    if (dialog.dataset.mode !== 'engineering') return;
    const { destination, candidate } = engineering.preview();
    const key = candidate ? candidate.blueprint.id : `body:${destination}`;
    if (key === engineeringPreviewKey) return;
    engineeringPreviewKey = key;
    previewTabs.hidden = true;
    if (candidate?.blueprint.carrier) {
      void showPreview('rocket', candidate.blueprint.carrier, 'Launcher', candidate.vehicle.name);
    } else if (candidate) {
      get('standard-preview-title').textContent = 'Launcher';
      get('standard-preview-caption').textContent = 'Your build';
      previewError.textContent = '';
      try { getPreview()?.showAssembly(candidate.blueprint.layout); }
      catch (error) { previewError.textContent = error.message; }
    } else {
      const title = standardDestinations.find(item => item.id === destination)?.title ?? destination;
      void showPreview('body', destination, 'Destination', title);
    }
  }
  dialog.addEventListener('engineering-preview-change', showEngineeringPreview);

  for (const button of previewTabs.querySelectorAll('button')) button.addEventListener('click', () => {
    previewKind = button.dataset.preview;
    showSelectedModel();
  });

  function persistAndRender() { invalidate(); store(); render(); }

  function renderDestinations() {
    get('standard-title').textContent = 'Destination';
    get('standard-subtitle').textContent = '';
    choices.dataset.layout = 'destinations';
    for (const item of standardDestinations) {
      const card = selectCard({ ...item, imageId: item.image, imageKind: 'body', selected: item.id === draft.destination, destination: true,
        onSelect() {
          if (draft.destination !== item.id) {
            draft.destination = item.id;
            draft.goal = item.id === 'moon' ? 'expedition' : item.id === 'earth' ? 'science' : 'flyby';
            draft.crewCount = item.id === 'moon' ? 4 : 0;
          }
          persistAndRender();
        } });
      card.dataset.destination = item.id;
      choices.append(card);
    }
  }

  function renderGoals() {
    get('standard-title').textContent = 'Mission objective';
    get('standard-subtitle').textContent = draft.destination === 'earth'
      ? '' : draft.destination === 'moon' ? ''
        : '';
    for (const goal of standardGoals[draft.destination]) {
      const card = selectCard({ ...goal, imageId: goal.image, imageKind: 'craft', selected: goal.id === draft.goal,
        onSelect() { draft.goal = goal.id; persistAndRender(); } });
      card.dataset.goal = goal.id;
      choices.append(card);
    }
  }

  function renderMissionType() {
    get('standard-title').textContent = 'Spacecraft';
    get('standard-subtitle').textContent = draft.destination === 'earth'
      ? ''
      : draft.destination === 'moon' ? ''
        : `Nominal transfer · ${fmt(nominalTransferS(draft.destination) / 86400)} days.`;
    for (const crew of [false, true]) {
      const available = crew === (draft.destination === 'moon');
      const card = selectCard({ title: crew ? 'Expedition spacecraft' : 'Uncrewed spacecraft', selected: available, available,
        description: available ? crew ? 'Life support and Earth return' : 'Autonomous and remote control'
          : crew ? 'Lunar expedition only' : 'Uncrewed lunar flight unavailable',
        onSelect() { draft.crewCount = crew ? 4 : 0; persistAndRender(); } });
      card.dataset.type = 'crew';
      card.dataset.crew = String(crew);
      const mark = node('div', 'standard-crew-mark');
      if (crew) for (let i = 0; i < 4; i++) mark.append(node('span', '', '◦'));
      else mark.textContent = '◈';
      card.prepend(mark);
      choices.append(card);
    }
    if (draft.crewCount) {
      const selection = node('div', 'standard-options');
      selection.append(node('span', '', 'Astronauts'));
      for (const count of [2, 4, 6]) {
        const button = node('button', '', String(count));
        button.type = 'button';
        button.disabled = count !== 4;
        button.setAttribute('aria-pressed', String(count === draft.crewCount));
        button.setAttribute('aria-label', `${count} astronauts${count !== 4 ? ' · unavailable' : ''}`);
        button.addEventListener('click', () => { draft.crewCount = count; persistAndRender(); });
        selection.append(button);
      }
      extra.append(selection);
    }
  }

  function renderInstruments() {
    const toolbar = node('div', 'standard-catalog-toolbar');
    const label = node('label');
    const search = node('input');
    search.type = 'search';
    search.placeholder = 'Find an instrument';
    search.setAttribute('aria-label', 'Search instruments');
    search.value = query;
    label.append(search);
    toolbar.append(label);
    extra.append(toolbar);
    const selected = draft.instrumentIds.map(id => instruments[id]);
    const total = node('div', 'standard-payload-total');
    total.append(node('span', '', `Selected ${selected.length}`),
      node('span', '', `${fmt(selected.reduce((sum, item) => sum + item.massKg, 0))} kg`),
      node('span', '', `${fmt(selected.reduce((sum, item) => sum + item.costM, 0))} M · instruments`));
    extra.prepend(total);
    const collection = node('div');
    collection.style.display = 'contents';
    const draw = () => {
      collection.replaceChildren();
      for (const item of Object.values(instruments).filter(value => value.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))) {
        const card = node('div', 'standard-card');
        card.dataset.selected = String(draft.instrumentIds.includes(item.id));
        const button = node('button', 'standard-payload-select');
        button.type = 'button';
        button.dataset.standardInstrument = item.id;
        button.setAttribute('aria-pressed', card.dataset.selected);
        button.setAttribute('aria-disabled', String(!item.orbitSupported));
        const text = node('span', 'standard-card-content');
        if (!item.orbitSupported) text.append(node('span', 'standard-unavailable', 'Different mission type'));
        text.append(node('strong', '', item.name), node('p', '', `${item.massKg} kg · ${fmt(item.costM)} M`));
        button.append(node('span', 'standard-card-check', '✓'), text);
        image(button, 'instrument', item.id);
        button.addEventListener('click', () => {
          if (!item.orbitSupported) { warning('Choose an instrument that supports Earth orbit.'); return; }
          draft.instrumentIds = draft.instrumentIds.includes(item.id) ? draft.instrumentIds.filter(id => id !== item.id) : [...draft.instrumentIds, item.id];
          invalidate();
          store();
          render();
          void showPreview('instrument', item.id, 'Instruments', item.name);
        });
        const detail = node('details');
        detail.append(node('summary', '', 'Specs'), node('p', '', item.purpose),
          node('p', '', `Peak power ${item.peakW} W · ${fmt(item.rateMBs)} MB/s · ${item.dimensionsM.join(' × ')} m`),
        );
        card.append(button, detail);
        collection.append(card);
      }
      if (!collection.children.length) collection.append(node('p', 'standard-footnote', 'No matching instruments.'));
    };
    search.addEventListener('input', () => { query = search.value; draw(); });
    draw();
    choices.append(collection);
    // Keep the catalog controls above the cards without losing the search focus.
    choices.before(extra);
    const budgets = node('div', 'standard-options');
    budgets.append(node('span', '', 'Payload budget'));
    for (const limit of [null, 10, 20, 40]) {
      const button = node('button', '', limit == null ? 'Unlimited' : `Up to ${limit} M`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(draft.budgetM === limit));
      button.addEventListener('click', () => { draft.budgetM = limit; persistAndRender(); });
      budgets.append(button);
    }
    extra.append(budgets);
  }

  function renderPayload() {
    get('standard-title').textContent = 'Payload';
    if (isPlanetaryDestination(draft.destination)) {
      get('standard-subtitle').textContent = 'Choose optional cargo.';
      for (const cargo of standardCargo) {
        const card = selectCard({ title: cargo.id === 'expedition' ? 'Science cargo' : cargo.name,
          description: `${cargo.massKg} kg extra cargo`, imageId: 'voyager', imageKind: 'craft', selected: draft.cargoId === cargo.id,
          onSelect() { draft.cargoId = cargo.id; persistAndRender(); } });
        card.dataset.cargo = cargo.id;
        choices.append(card);
      }
    } else if (draft.destination === 'moon') {
      get('standard-subtitle').textContent = 'Choose optional cargo.';
      for (const cargo of standardCargo) {
        const card = selectCard({ title: cargo.name, description: `${cargo.description} · ${cargo.massKg} kg`,
          imageId: 'orion', imageKind: 'craft', selected: draft.cargoId === cargo.id,
          onSelect() { draft.cargoId = cargo.id; persistAndRender(); } });
        card.dataset.cargo = cargo.id;
        choices.append(card);
      }
    } else if (draft.goal === 'orbit') {
      get('standard-subtitle').textContent = '';
      const card = selectCard({ title: 'Test flight', description: 'Test payload',
        imageId: 'dart', imageKind: 'craft', selected: true, onSelect() {} });
      choices.append(card);
    } else {
      get('standard-subtitle').textContent = draft.goal === 'science' ? 'Select instruments.'
        : 'Instruments are optional.';
      renderInstruments();
    }
  }

  function metric(container, title, value, unit) {
    const box = node('div');
    box.append(node('span', '', title), node('strong', '', value), node('small', '', unit));
    container.append(box);
  }

  function renderOverview() {
    const { spec, plan, candidate } = result;
    get('standard-title').textContent = candidate?.ready ? 'Mission ready' : 'Review mission';
    get('standard-subtitle').textContent = candidate?.ready ? '' : 'Resolve the failed checks.';
    overview.hidden = false;
    const name = node('label', 'standard-summary-name');
    name.append(node('span', '', 'Mission name'));
    const input = node('input');
    input.id = 'standard-mission-name';
    input.value = spec.name;
    input.maxLength = 100;
    input.addEventListener('change', () => {
      const title = input.value.trim();
      if (!title) { input.value = result.spec.name; return; }
      draft.name = title;
      result.spec = { ...result.spec, name: title };
      dirty = true;
      store();
    });
    name.append(input);
    overview.append(name);
    const route = node('div', 'standard-route');
    for (const [index, label] of (plan.interplanetary ? ['Earth', `${spec.type === 'orbit' ? 'Orbit' : 'Flyby'} · ${bodyNames[spec.destination]}`]
      : spec.expedition ? ['Earth', 'Lunar orbit', 'Earth'] : ['Earth', 'Earth orbit']).entries()) {
      if (index) route.append(node('span', 'standard-route-arrow', '→'));
      const place = node('span', '', label);
      place.append(node('small', '', index === 0 ? 'Kennedy · LC-39A' : spec.expedition && index === 2 ? 'Splashdown' : `${fmt(spec.orbit.periapsisM / 1000)} km`));
      route.append(place);
    }
    overview.append(route);
    if (!candidate) {
      warning(plan.unavailable.join(' ') || 'No compatible launcher.', () => go(3), 'Edit payload');
      return;
    }
    const metrics = node('div', 'standard-metrics');
    metric(metrics, 'Launch mass', fmt(candidate.performance.wetMassKg / 1000), 't');
    metric(metrics, spec.expedition ? 'Expedition' : 'Payload', spec.expedition ? '4' : fmt(plan.interplanetary?.wetKg ?? candidate.spacecraft?.massKg), spec.expedition ? 'astronauts' : 'kg');
    metric(metrics, 'Payload budget', candidate.spacecraft ? fmt(candidate.spacecraft.costM) : '—', candidate.spacecraft ? 'M game credits' : 'Unknown');
    overview.append(metrics);
    const systems = node('div', 'standard-system-list');
    if (candidate.spacecraft) {
      for (const key of ['panels', 'battery', 'computer', 'attitude', 'radio']) systems.append(node('span', '', candidate.spacecraft[key].name));
    } else if (spec.expedition) {
      systems.append(node('span', '', `O₂ ${fmt(spec.cabin.oxygenKg)} kg`), node('span', '', `Water ${fmt(spec.cabin.waterKg)} kg`),
        node('span', '', `Food ${fmt(spec.cabin.foodKg)} kg`), node('span', '', `Service fuel ${fmt(plan.expedition.fuelKg * spec.expedition.serviceFuelFraction)} kg`));
    }
    if (plan.interplanetary) systems.append(node('span', '', `Transfer ${fmt(plan.interplanetary.route.transferS / 86400)} days`),
      node('span', '', `Departure ${plan.interplanetary.route.departureUtc.slice(0,10)} UTC`),
      node('span', '', `Injection ${fmt(plan.interplanetary.route.departureMps)} m/s`), node('span', '', `Capture ${fmt(plan.interplanetary.route.captureMps)} m/s`),
      node('span', '', `Probe fuel ${fmt(plan.interplanetary.fuelKg)} kg`));
    overview.append(systems);
    const payload = node('div', 'standard-manifest');
    payload.append(node('span', 'standard-manifest-label', spec.expedition ? 'Crew & cargo' : 'Payload'));
    if (spec.expedition) {
      payload.append(node('p', '', `4 astronauts · ${standardCargo.find(item => item.id === draft.cargoId).name} · ${fmt(spec.payloadMassKg)} kg`));
    } else if (candidate.spacecraft) {
      payload.append(node('p', '', candidate.spacecraft.selected.map(item => item.name).join(' · ') || 'Satellite systems'));
    } else if (plan.interplanetary) payload.append(node('p', '', `Uncrewed probe · extra cargo ${fmt(spec.payloadMassKg)} kg`));
    else payload.append(node('p', '', 'Standard launcher payload'));
    const propellant = candidate.performance.stages.reduce((sum, stage) => sum + stage.propellantKg, 0);
    payload.append(node('small', '', `Launcher fuel · ${fmt(propellant / 1000)} t${ candidate.spacecraft ? ` · Power ${fmt(candidate.spacecraft.solarW)} W · Battery ${fmt(candidate.spacecraft.battery.capacityWh)} Wh` : ''}`));
    overview.append(payload);
    const program = node('ol', 'standard-phase-list');
    for (const phase of plan.phases) program.append(node('li', '', phase.name));
    overview.append(program);
    const checks = node('div', 'standard-checks');
    for (const item of candidate.checks.filter(item => ['payload', 'liftoff-twr', 'delta-v', 'solar-power', 'eclipse-energy', 'power', 'lunar-fuel', 'budget', 'structures'].includes(item.id))) {
      const row = node('div', 'standard-check', `${item.label}${item.status === 'UNKNOWN' ? ' · limited model' : item.status === 'FAIL' ? ' · needs changes' : ''}`);
      row.dataset.status = item.status;
      checks.append(row);
    }
    overview.append(checks);
    const report = node('details', 'standard-report');
    report.append(node('summary', '', 'Technical checks'));
    const list = node('ul');
    for (const check of candidate.checks) list.append(node('li', '', `${check.status === 'PASS' ? '✓' : check.status === 'FAIL' ? '!' : '•'} ${check.label}. ${check.reason}${check.status !== 'PASS' && check.action ? ' ' + check.action : ''}`));
    report.append(list);
    overview.append(report);
    const actions = node('div', 'standard-launch-actions');
    const edit = node('button', 'standard-edit', 'Edit Mission');
    edit.type = 'button';
    edit.addEventListener('click', () => go(0));
    const engineeringButton = node('button', 'standard-edit', 'Engineering settings');
    engineeringButton.type = 'button';
    engineeringButton.addEventListener('click', () => switchMode('engineering'));
    actions.append(edit, engineeringButton);
    overview.append(actions);
    if (!candidate.ready) {
      const failures = candidate.checks.filter(item => item.status === 'FAIL');
      warning(failures.map(item => item.action || item.reason).join(' ') || plan.unavailable.join(' '), () => go(3), 'Edit payload');
      if (spec.spacecraft) {
        const reset = node('button', '', 'Use default camera');
        reset.type = 'button';
        reset.addEventListener('click', () => { draft.instrumentIds = ['wide']; persistAndRender(); });
        problems.append(reset);
      }
    }
    previewTabs.hidden = false;
    showSelectedModel();
  }

  async function prepare() {
    if (controller) return;
    const token = new AbortController();
    controller = token;
    choices.replaceChildren();
    const preparation = node('div', 'standard-preparing');
    const message = node('span', '', 'Selecting launcher and systems…');
    preparation.append(node('span', 'standard-spinner'), message);
    choices.append(preparation);
    next.disabled = true;
    next.dataset.loading = 'true';
    try {
      const prepared = await prepareStandardMission(draft, previewOptions.specs, { signal: token.signal,
        progress: count => { message.textContent = `Checked ${count} configurations`; } });
      token.signal.throwIfAborted();
      result = prepared;
      render();
    } catch (error) {
      if (!token.signal.aborted) warning(error.message, () => { result = null; void prepare(); }, 'Retry');
    } finally {
      if (controller === token) controller = null;
      next.dataset.loading = 'false';
    }
  }

  function go(step) {
    if (step < draft.step) { controller?.abort(); controller = null; }
    draft.step = step;
    store();
    render();
    get('standard-title').focus({ preventScroll: true });
    dialog.scrollTop = 0;
    dialog.querySelector('.standard-main').scrollTop = 0;
    dialog.querySelector('.standard-layout').scrollTop = 0;
  }

  function render() {
    const main = dialog.querySelector('.standard-main');
    const scroll = main.scrollTop;
    choices.replaceChildren();
    extra.replaceChildren();
    choices.after(extra);
    overview.replaceChildren();
    problems.hidden = true;
    overview.hidden = true;
    get('standard-flight-format').hidden = draft.step !== 4;
    flightLength.value = draft.flightLength;
    previewTabs.hidden = true;
    choices.dataset.layout = 'cards';
    steps.replaceChildren();
    const destination = standardDestinations.find(item => item.id === draft.destination);
    const goal = standardGoals[draft.destination].find(item => item.id === draft.goal);
    get('standard-context').textContent = draft.step ? `${destination.title} / ${goal.title}` : '';
    for (const [index, title] of stepNames.entries()) {
      const button = node('button');
      button.type = 'button';
      button.disabled = index > draft.step;
      button.dataset.done = String(index < draft.step);
      if (index === draft.step) button.setAttribute('aria-current', 'step');
      button.append(node('span', '', index < draft.step ? '✓' : String(index + 1)), document.createTextNode(title));
      button.addEventListener('click', () => go(index));
      steps.append(button);
    }
    back.disabled = false;
    back.textContent = draft.step ? '← Back' : 'My missions';
    next.textContent = draft.step === 4 ? 'Launch Mission ↗' : draft.step === 3 ? 'Review →' : 'Continue →';
    next.disabled = draft.step === 4 ? !result?.candidate?.ready : draft.step === 3 && draft.goal === 'science' && draft.instrumentIds.length === 0;
    if (draft.step !== 4) void showPreview('body', destination.id, destination.title, draft.step === 2 && draft.crewCount ? '4 seats' : draft.destination === 'earth' ? 'Low Earth orbit' : draft.destination === 'moon' ? 'Orbital expedition' : 'Interplanetary probe');
    switch (draft.step) {
      case 0: renderDestinations(); break;
      case 1: renderGoals(); break;
      case 2: renderMissionType(); break;
      case 3: renderPayload(); break;
      case 4:
        if (result) renderOverview();
        else {
          get('standard-title').textContent = 'Preparing mission';
          get('standard-subtitle').textContent = '';
          void prepare();
        }
        break;
    }
    main.scrollTop = scroll;
  }

  function switchMode(mode) {
    const previous = dialog.dataset.mode;
    dialog.dataset.mode = mode;
    get('standard-mode').hidden = mode !== 'standard';
    get('engineering-mode').hidden = mode !== 'engineering';
    for (const button of dialog.querySelectorAll('[data-designer-mode]')) button.setAttribute('aria-pressed', String(button.dataset.designerMode === mode));
    controller?.abort();
    controller = null;
    if (mode === 'engineering') {
      engineeringPreviewKey = '';
      get('engineering-preview-slot').append(previewPanel);
      let spec = null;
      try { spec = result?.spec ?? (dirty ? standardMissionSpecification(draft) : null); }
      catch (error) { saveStatus.textContent = error.message; }
      engineering.open(spec);
      showEngineeringPreview();
    } else {
      standardLayout.append(previewPanel);
      if (previous === 'engineering') {
        try {
          const spec = engineering.read();
          const nextDraft = standardDraftFromMission(spec);
          if (nextDraft) {
            if (spec.id !== draft.id) nextDraft.id = crypto.randomUUID();
            draft = nextDraft;
            invalidate();
            store();
          }
        } catch { /* Keep the last valid Standard draft while a form is incomplete. */ }
      }
      render();
    }
    dialog.scrollTop = 0;
  }

  back.addEventListener('click', () => {
    if (draft.step) go(draft.step - 1);
    else { switchMode('engineering'); engineering.showProjects(); }
  });
  flightLength.addEventListener('change', () => {
    draft.flightLength = flightLength.value;
    store();
  });
  next.addEventListener('click', async () => {
    if (draft.step < 4) { go(draft.step + 1); return; }
    if (!result?.candidate?.ready || launched) return;
    launched = true;
    next.disabled = true;
    try {
      result.spec = engineering.savePrepared({ ...result.spec, flightLength: draft.flightLength }, result.candidate);
      const { spec, candidate } = result;
      await startFlight({ spec, layout: candidate.blueprint.layout, carrier: candidate.blueprint.carrier,
        vehicle: candidate.vehicle, cabin: candidate.cabin, checks: candidate.checks });
      dialog.close();
    } catch (error) { warning(error.message); }
    finally { launched = false; next.disabled = !result?.candidate?.ready; }
  });
  for (const button of dialog.querySelectorAll('[data-designer-mode]')) button.addEventListener('click', () => switchMode(button.dataset.designerMode));
  get('design-open').addEventListener('click', () => {
    switchMode('standard');
    if (!dialog.open) dialog.showModal();
    store();
    getPreview();
  });
  dialog.addEventListener('close', () => { controller?.abort(); controller = null; });
  return {
    open() { get('design-open').click(); },
    openProjects() { get('design-open').click(); switchMode('engineering'); engineering.showProjects(); },
    render(dt) {
      if (!dialog.open) return false;
      getPreview()?.render(dt);
      return true;
    },
  };
}
