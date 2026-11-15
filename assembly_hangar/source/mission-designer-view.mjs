import { finite, missionTypes, newMission, playableLunarExpedition, readMission } from './mission-specification.mjs';
import { planMission } from './mission-plan.mjs';
import { assessVehicle, searchVehicles } from './mission-engineering.mjs';
import { cabinFields, requiredCabinFields } from './cabin-profile.mjs';
import { missionProject, readProject } from './mission-projects.mjs';
import { setupProjectLibrary } from './mission-projects-view.mjs';
import { setupSatelliteTelemetry, setupSpacecraftDesigner } from './spacecraft-view.mjs';
import { defaultSpacecraft } from './spacecraft-design.mjs';
import { twoStageExample } from './rocket-interstages.mjs';
import { lunarHardware } from './lunar-expedition.mjs';
import { setupEngineeringMissionView } from './engineering-mission-view.mjs';
import { bodyNames, defaultProbe, isPlanetaryDestination, planetaryOrbit, YEAR_S } from './mission-planets.mjs';

const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const fmt = value => Number.isFinite(value) ? formatter.format(value) : '—';
const stateLabels = { LOCKED: 'Pending', ACTIVE: 'Active', COMPLETED: 'Confirmed', FAILED: 'Incomplete', SKIPPED: 'Skipped' };
const outcomeLabels = { ACTIVE: 'Flight', COMPLETED: 'Objectives complete', INCOMPLETE: 'Objectives unconfirmed', FAILED: 'Failed', ABORTED: 'Aborted' };
const bodies = bodyNames;
const selectFields = {
  origin: bodies, destination: bodies, type: missionTypes,
  start: { surface: 'Surface', orbit: 'Orbit' },
  site: { '': 'Unset', lc39a: 'LC-39A' },
  payloadType: { ballast: 'Ballast', equipment: 'Equipment' },
  assembly: { auto: 'Automatic', assisted: 'Assisted', manual: 'Current hangar build' },
  optimization: { mass: 'Lower launch mass', 'delta-v': 'Higher ideal Δv' },
};

function line(tag, content, parent, status) {
  const item = document.createElement(tag);
  item.textContent = content;
  if (status) item.dataset.check = status;
  parent.append(item);
  return item;
}

export function setupMissionDesigner({ specs, builder, launch, showLaunch }) {
  const get = id => document.getElementById(id);
  const dialog = get('mission-designer');
  const form = get('design-form');
  const field = name => form.elements.namedItem(name);
  const status = get('design-status');
  const report = get('design-report');
  const phases = get('design-phases');
  const candidates = get('design-candidate');
  const apply = get('design-apply');
  const cancel = get('design-cancel');
  let controller = null;
  let results = [];
  let mission;
  let lastResult = '';
  const recordedFlights = new WeakSet();
  const projects = setupProjectLibrary({ specs, status, fmt, outcomeLabels, edit(project) {
    invalidate();
    fill(project?.spec ?? newMission());
    if (project?.spec.assembly === 'manual' && project.selection?.layout) {
      window.dispatchEvent(new CustomEvent('jugre-open-assembly', { detail: { spec: project.spec, blueprint: project.selection } }));
      dialog.close();
    }
  } });
  const assemblyButton = document.createElement('button');
  assemblyButton.id = 'design-open-assembly';
  assemblyButton.type = 'button';
  assemblyButton.className = 'control emphasis';
  assemblyButton.textContent = 'Build in hangar';
  apply.after(assemblyButton);
  assemblyButton.addEventListener('click', () => {
    try {
      window.dispatchEvent(new CustomEvent('jugre-open-assembly', { detail: {
        spec: read(), blueprint: results[Number(candidates.value)]?.blueprint,
      } }));
      dialog.close();
    } catch (error) { status.textContent = error.message; }
  });

  for (const [name, options] of Object.entries(selectFields)) {
    for (const [value, label] of Object.entries(options)) field(name).add(new Option(label, value));
  }
  for (const [id, part] of specs) field('availableParts').add(new Option(`${part.code} · ${part.name}`, id));
  for (const [id, hardware] of Object.entries(lunarHardware)) field('expeditionHardware').add(new Option(hardware.name, id));
  for (const [id, label, min, max] of cabinFields) {
    const wrapper = line('label', requiredCabinFields.has(id) ? `${label} *` : label, get('design-cabin-fields'));
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', name: id, min, max, step: 'any' });
    wrapper.append(input);
  }
  const spacecraft = setupSpacecraftDesigner(field, fmt);
  const editor = setupEngineeringMissionView({ field, fmt });
  const renderSatellite = setupSatelliteTelemetry(fmt);
  function syncExpedition() {
    const panel = get('design-expedition');
    panel.hidden = field('destination').value !== 'moon';
    get('design-expedition-settings').disabled = !field('expeditionHardware').value;
    get('design-interplanetary').hidden = !isPlanetaryDestination(field('destination').value);
  }

  function fill(spec) {
    mission = spec;
    const values = { ...Object.fromEntries(cabinFields.map(([id]) => [id, spec.cabin?.[id] ?? null])), ...spec,
      periapsisKm: spec.orbit?.periapsisM / 1000, apoapsisKm: spec.orbit?.apoapsisM / 1000,
      toleranceKm: spec.orbit?.toleranceM / 1000, inclinationDeg: spec.orbit?.inclinationDeg, launchUtc: spec.launchUtc?.slice(0, 19),
      durationHours: spec.durationS == null ? null : spec.durationS / 3600, transferHours: spec.transferS == null ? null : spec.transferS / 3600,
      expeditionHardware: spec.expedition?.hardware ?? '', lunarFuelPercent: (spec.expedition?.serviceFuelFraction ?? 1) * 100,
      lunarOperationsHours: (spec.expedition?.operationsS ?? 86400) / 3600, lunarReturnHours: (spec.expedition?.returnS ?? 70 * 3600) / 3600,
      probeDryKg: spec.interplanetary?.dryKg ?? defaultProbe.dryKg, probeFuelKg: spec.interplanetary?.fuelKg ?? defaultProbe.fuelKg,
      probeIspS: spec.interplanetary?.ispS ?? defaultProbe.ispS,
      propellantPercent: spec.propellantFraction * 100, upperThrottlePercent: (spec.upperThrottle ?? 1) * 100, marginPercent: spec.safetyMargin * 100 };
    for (const input of form.elements) {
      if (!input.name || input.multiple || !(input.name in values)) continue;
      if (input.type === 'checkbox') input.checked = values[input.name];
      else input.value = values[input.name] == null || Number.isNaN(values[input.name]) ? '' : values[input.name];
    }
    for (const option of field('availableParts').options) option.selected = spec.availableParts.includes(option.value);
    get('design-category').textContent = spec.category === 'custom' ? 'Custom mission' : 'Preset';
    get('design-cabin').open = Boolean(spec.cabin);
    get('design-expedition').open = Boolean(spec.expedition);
    syncExpedition();
    spacecraft.fill(spec);
    editor.go(0, false);
  }

  function read() {
    const n = name => field(name).value === '' ? null : field(name).valueAsNumber;
    const v = name => field(name).value;
    const km = name => finite(n(name), 'Orbit altitude, km', .001, 1e6) * 1000;
    const hours = (name, limit) => n(name) == null ? null : finite(n(name), 'Time, h', 1 / 3600, limit) * 3600;
    const utc = v('launchUtc');
    const cabin = Object.fromEntries(cabinFields.map(([id]) => [id, n(id)]));
    return readMission({
      ...mission, name: v('name'), description: v('description'), origin: v('origin'), destination: v('destination'),
      site: v('site') || null, start: v('start'), type: v('type'), launchUtc: utc ? `${utc.length === 16 ? utc + ':00' : utc}.000Z` : null,
      flightLength: v('flightLength'),
      payloadMassKg: n('payloadMassKg'), payloadType: v('payloadType'), equipment: v('equipment'),
      crewCount: n('crewCount'), crewMassKgEach: n('crewMassKgEach'), returnRequired: field('returnRequired').checked,
      durationS: hours('durationHours', 100 * YEAR_S / 3600), transferS: hours('transferHours', 100 * YEAR_S / 3600),
      orbit: ['periapsisKm', 'apoapsisKm', 'toleranceKm', 'inclinationDeg'].every(name => n(name) == null) ? null : {
        periapsisM: km('periapsisKm'), apoapsisM: km('apoapsisKm'), toleranceM: km('toleranceKm'), inclinationDeg: n('inclinationDeg'),
      },
      assembly: v('assembly'), optimization: v('optimization'), maxMassKg: n('maxMassKg'),
      availableParts: [...field('availableParts').selectedOptions].map(option => option.value),
      propellantFraction: finite(n('propellantPercent'), 'Fuel, %', 0, 100) / 100,
      upperThrottle: finite(n('upperThrottlePercent'), 'Upper-stage throttle limit, %', 10, 100) / 100,
      safetyMargin: finite(n('marginPercent'), 'Margin, %', 0, 100) / 100,
      cabin: Object.values(cabin).some(value => value != null) ? cabin : null,
      spacecraft: spacecraft.read(),
      interplanetary: isPlanetaryDestination(v('destination')) ? { dryKg: n('probeDryKg'), fuelKg: n('probeFuelKg'), ispS: n('probeIspS') } : null,
      expedition: v('destination') === 'moon' && v('expeditionHardware') ? { hardware: v('expeditionHardware'),
        serviceFuelFraction: finite(n('lunarFuelPercent'), 'Service-module fuel, %', 0, 100) / 100,
        operationsS: hours('lunarOperationsHours', 72), returnS: hours('lunarReturnHours', 144) } : null,
    });
  }

  function store(spec, selection) {
    mission = spec;
    try {
      const library = projects.current();
      const previous = library.get(spec.id);
      const layout = spec.assembly === 'manual' ? builder.getLayout() : null;
      const selected = selection ?? (layout ? (layout.length ? { layout } : null)
        : previous?.spec.assembly === spec.assembly ? previous.selection : null);
      const item = readProject(missionProject(spec, selected), specs);
      item.archived = previous?.archived ?? false;
      if (JSON.stringify(item.spec) === JSON.stringify(previous?.spec)) item.result = previous.result;
      library.save(item);
      mission = item.spec;
      projects.refresh(spec.id);
      return 'Mission saved.';
    }
    catch (error) { return `Saved for this session · ${error.message}`; }
  }

  function invalidate() {
    controller?.abort();
    controller = null;
    results = [];
    candidates.replaceChildren();
    report.replaceChildren();
    phases.replaceChildren();
    apply.disabled = true;
    get('design-risk').checked = false;
    editor.update({ candidate: null, busy: false });
  }

  function renderReport() {
    const selected = results[Number(candidates.value)];
    report.replaceChildren();
    apply.disabled = !selected?.executable || (!selected.ready && !get('design-risk').checked);
    editor.update({ candidate: selected ?? null });
    if (!selected) return;
    const { performance: p, blueprint, checks } = selected;
    const summary = line('div', '', report);
    summary.className = 'engineering-readiness';
    summary.dataset.ready = String(selected.ready);
    line('strong', selected.ready ? 'Ready for launch' : 'Check limitations', summary);
    const failureCount = checks.filter(item => item.status === 'FAIL').length;
    const limitedCount = checks.filter(item => item.status !== 'PASS' && item.status !== 'FAIL').length;
    line('p', selected.ready ? `Checks passed${limitedCount ? ` · model limits · ${limitedCount}` : ''}.`
      : `Changes needed · ${failureCount} · model limits · ${limitedCount}.`, summary);
    const metrics = line('div', '', report);
    metrics.className = 'standard-metrics';
    for (const [label, value, unit] of [['Launch mass', p.wetMassKg / 1000, 't'], ['Thrust-to-weight', p.twr, 'TWR'], ['Ideal Δv', p.idealMps, 'm/s']]) {
      const box = line('div', '', metrics);
      line('span', label, box);
      line('strong', fmt(value), box);
      line('small', unit, box);
    }
    const checkList = line('div', '', report);
    checkList.className = 'standard-checks';
    for (const item of checks.filter(item => item.status !== 'PASS' || ['payload', 'liftoff-twr', 'delta-v', 'seats', 'lunar-fuel', 'solar-power', 'power'].includes(item.id))) {
      const row = line('div', `${item.label} · ${item.status === 'PASS' ? 'Ready' : item.status === 'FAIL' ? 'Needs changes' : 'Limited'}`, checkList);
      row.className = 'standard-check';
      row.dataset.status = item.status;
      if (item.status !== 'PASS') line('small', item.action || item.reason, row);
    }
    const details = line('details', '', report);
    details.className = 'engineering-details';
    line('summary', 'Engineering report', details);
    line('p', `Thrust ${fmt(p.thrustN / 1000)} kN`, details);
    if (selected.spacecraft) {
      const design = selected.spacecraft;
      line('p', `Spacecraft ${fmt(design.massKg)} kg · ${fmt(design.costM)} M · power ${fmt(design.solarW)} W · storage ${fmt(design.computer.storageMB)} MB`, details);
    }
    const stack = document.createElement('ul');
    for (const stage of p.stages) line('li', `${stage.id} · fuel ${fmt(stage.propellantKg)} kg · Δv ${fmt(stage.idealMps)} m/s`, stack);
    details.append(stack);
    if (blueprint.components.length) line('p', blueprint.components.map(part => specs.get(part.part).code).join(' · '), details);
    const list = document.createElement('ul');
    for (const item of checks) {
      const value = item.actual != null ? ` [${fmt(item.actual)} / ${fmt(item.required)} ${item.unit ?? ''}]` : '';
      const detail = line('li', `${item.status} · ${item.label}${value}. ${item.reason}${item.status !== 'PASS' && item.action ? ' ' + item.action : ''}`, list, item.status);
      detail.title = `${item.phase} · ${item.source}`;
    }
    details.append(list);
  }

  function openEditor(spec = null) {
    if (spec) { invalidate(); fill(readMission(spec)); }
    if (!mission) {
      try {
        const library = projects.current();
        const project = library.get(library.active());
        mission = project?.spec ?? newMission();
        get('design-show-archive').checked = project?.archived ?? false;
        projects.refresh(project?.spec.id);
        if (project?.spec.assembly === 'manual' && project.selection?.layout) builder.applyBlueprint(project.selection);
      }
      catch (error) { mission = newMission(); status.textContent = error.message; }
      fill(mission);
    }
    if (!dialog.open) dialog.showModal();
    editor.update();
  }
  form.addEventListener('input', event => {
    if (event.target.closest('#design-library')) return;
    if (event.target === field('flightLength')) return;
    if (spacecraft.filterInput(event.target)) return;
    if (event.target === field('destination') && isPlanetaryDestination(event.target.value)) {
      const orbit = planetaryOrbit(event.target.value);
      for (const name of ['periapsis', 'apoapsis', 'tolerance']) field(`${name}Km`).value = orbit[`${name}M`] / 1000;
      field('inclinationDeg').value = '';
      if (!['flyby', 'orbit'].includes(field('type').value)) field('type').value = 'flyby';
      field('crewCount').value = 0;
      field('returnRequired').checked = false;
      field('durationHours').value = field('transferHours').value = field('launchUtc').value = '';
    }
    spacecraft.update();
    syncExpedition();
    if (event.target === field('type') && ['science', 'deployment'].includes(event.target.value)) get('design-spacecraft').open = true;
    invalidate();
    status.textContent = 'Settings changed. Recalculate.';
  });
  dialog.addEventListener('close', () => controller?.abort());
  form.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !event.target.matches('input:not([type=checkbox])') || event.target.closest('#design-library')) return;
    event.preventDefault();
    if (!spacecraft.filterInput(event.target) && editor.step < 4) editor.go(editor.step + 1);
  });
  get('design-close').addEventListener('click', () => dialog.close());
  get('design-lunar').addEventListener('click', () => {
    invalidate();
    fill(playableLunarExpedition());
    status.textContent = 'Lunar expedition loaded.';
  });
  get('design-new').addEventListener('click', () => { invalidate(); fill(newMission()); status.textContent = ''; });
  get('design-earth-science').addEventListener('click', () => {
    invalidate();
    fill({ ...newMission(), name: 'Earth Observation', type: 'science', durationS: 4 * 3600, spacecraft: defaultSpacecraft });
    status.textContent = '';
  });
  get('design-staging-example').addEventListener('click', () => {
    invalidate();
    const spec = newMission();
    fill({ ...spec, name: 'Two-stage Satellite', type: 'science', assembly: 'manual', durationS: 4 * 3600,
      spacecraft: defaultSpacecraft, upperThrottle: .7, orbit: { ...spec.orbit, apoapsisM: 310000, toleranceM: 75000 } });
    builder.applyBlueprint({ layout: twoStageExample });
    status.textContent = 'Example loaded in hangar.';
  });
  get('design-save').addEventListener('click', () => {
    try { status.textContent = store(read()); }
    catch (error) { status.textContent = error.message; }
  });
  cancel.addEventListener('click', () => controller?.abort());
  candidates.addEventListener('change', renderReport);
  get('design-risk').addEventListener('change', renderReport);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!event.submitter && editor.step < 4) { editor.go(editor.step + 1); return; }
    invalidate();
    editor.go(4);
    editor.update({ busy: true });
    const token = new AbortController();
    controller = token;
    cancel.disabled = false;
    try {
      const spec = read();
      const plan = planMission(spec);
      const saved = store(spec);
      for (const phase of plan.phases) line('li', phase.name, phases);
      for (const req of plan.requirements) line('li', `${req.method} · ${fmt(req.value)} ${req.unit}`, phases);
      for (const message of plan.unavailable) line('li', message, phases, 'UNKNOWN');
      if (plan.lunar && !plan.expedition && spec.launchUtc && spec.transferS && spec.orbit && !plan.trajectory) line('li', 'No Lambert solution for this transfer time.', phases, 'UNKNOWN');
      status.textContent = 'Checking parts and limits…';
      const savedSelection = (() => {
        try { return projects.current().get(spec.id)?.selection; }
        catch { return null; }
      })();
      const found = spec.assembly === 'manual' ? [assessVehicle(plan, builder.getLayout(), specs)]
        : await searchVehicles(plan, specs, { signal: token.signal,
          progress: count => { status.textContent = `Configurations checked · ${count}`; } });
      token.signal.throwIfAborted();
      results = found;
      for (const [index, candidate] of results.entries()) {
        const { blueprint, vehicle, performance, ready } = candidate;
        candidates.add(new Option(`${ready ? 'Ready' : 'Review'} · ${blueprint.carrier ? vehicle.name : blueprint.components.map(part => specs.get(part.part).code).join(' / ')} · ${fmt(performance.wetMassKg)} kg`, index));
      }
      if (savedSelection) {
        const id = readProject(missionProject(spec, savedSelection), specs).spec.blueprintId;
        const savedIndex = results.findIndex(item => item.blueprint.id === id);
        if (savedIndex >= 0) candidates.value = String(savedIndex);
      }
      renderReport();
      status.textContent = `${saved} Checked ${results.length}. ${results.some(item => item.ready) ? 'Flight configuration available.' : 'No matching configurations.'}`;
    } catch (error) {
      if (controller === token) status.textContent = token.signal.aborted ? 'Calculation stopped.' : error.message;
    } finally {
      if (controller === token) { controller = null; cancel.disabled = true; editor.update({ busy: false }); }
    }
  });
  apply.addEventListener('click', async () => {
    const candidate = results[Number(candidates.value)];
    if (!candidate?.executable || (!candidate.ready && !get('design-risk').checked)) return;
    try {
      const spec = readMission({ ...read(), blueprintId: candidate.blueprint.id });
      const saved = store(spec, candidate.blueprint);
      status.textContent = saved;
      if (!saved.startsWith('Mission saved.')) return;
      if (candidate.blueprint.layout && spec.assembly !== 'manual') builder.applyBlueprint(candidate.blueprint);
      showLaunch();
      await launch.selectDesign({ spec, layout: candidate.blueprint.layout, carrier: candidate.blueprint.carrier,
        vehicle: candidate.vehicle, cabin: candidate.cabin, checks: candidate.checks });
      dialog.close();
    } catch (error) { status.textContent = error.message; }
  });

  const resultPanel = get('design-flight');
  const resultSummary = get('design-flight-summary');
  const goals = get('design-flight-goals');
  const warnings = get('design-flight-warnings');
  const crewPanel = get('crew-life-panel');
  const crewReadings = get('crew-life-readings');
  const crewControls = get('crew-life-controls');
  let currentFlight;
  let crewViewFlight;
  const equipment = {
    power: 'Power', ventilation: 'Ventilation', scrubber: 'CO₂ scrubber',
    electrolysis: 'O₂ generator', waterRecovery: 'Water recovery', thermal: 'Thermal control', reserve: 'O₂ reserve',
  };
  const activities = { nominal: 'Nominal', sleep: 'Sleep', exercise: 'Exercise' };
  const alertText = {
    'low-oxygen': 'Low inspired O₂ pressure', 'high-co2': 'Mean CO₂ above 3 mmHg',
    'cabin-pressure': 'Cabin pressure out of range', humidity: 'High humidity', temperature: 'High temperature',
    ventilation: 'Ventilation off', power: 'Main power unavailable', scrubber: 'CO₂ scrubber offline',
    'oxygen-reserve': 'Main O₂ depleted', consumables: 'Water or food depleted',
  };
  function crewCommand(event) {
    const input = event.target;
    try {
      if (input.dataset.equipment) currentFlight.commandCrew('system', input.dataset.equipment, input.checked);
      if (input.dataset.activity) currentFlight.commandCrew('activity', input.dataset.activity, input.value);
      if (input.dataset.leak) currentFlight.commandCrew('leak', 'cabin', input.valueAsNumber);
      input.setCustomValidity('');
    } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
  }
  crewControls.addEventListener('change', crewCommand);

  function renderCrew(flight) {
    const life = flight?.lifeSupport;
    crewPanel.hidden = !life;
    if (!life) { crewViewFlight = null; return; }
    if (crewViewFlight !== flight) {
      crewViewFlight = flight;
      crewControls.replaceChildren();
      for (const member of life.crew) {
        const label = line('label', member.id === 'crew-1' ? 'Commander' : 'Specialist', crewControls);
        const select = document.createElement('select');
        select.dataset.activity = member.id;
        for (const [id, name] of Object.entries(activities)) select.add(new Option(name, id));
        select.value = member.activity;
        label.append(select);
      }
      for (const [id, title] of Object.entries(equipment)) {
        const label = line('label', '', crewControls);
        const input = document.createElement('input');
        Object.assign(input, { type: 'checkbox', checked: life.controls[id] });
        input.dataset.equipment = id;
        label.append(input, title);
      }
      const label = line('label', 'Test leak at nominal pressure, kg/s', crewControls);
      const input = document.createElement('input');
      Object.assign(input, { type: 'number', min: 0, max: 1, step: 'any', value: flight.systems.leakKgPerS });
      input.dataset.leak = 'true';
      label.append(input);
    }
    for (const input of crewControls.querySelectorAll('input, select')) input.disabled = flight.complete || flight.failed || flight.aborted;
    const remaining = Math.max(0, (flight.design?.spec.durationS ?? flight.mission.phases.reduce((total,p)=>total+p.duration,0)) - Math.max(0, flight.timeline.clock.seconds));
    const ready = life.readiness(remaining);
    const lines = [
      `${ready.ready ? 'Supplies nominal' : 'Life support limit'} · ${fmt(ready.enduranceS / 3600)} h remaining`,
      ...ready.alerts.map(id => alertText[id] ?? id),
    ];
    const text = lines.join('\n');
    if (crewReadings.textContent !== text) crewReadings.textContent = text;
  }
  return {
    open: openEditor,
    read,
    showProjects() {
      editor.go(0);
      get('design-library').open = true;
      get('design-library').scrollIntoView({ block: 'nearest' });
    },
    preview() {
      return { destination: field('destination').value, candidate: results[Number(candidates.value)] };
    },
    projects,
    savePrepared(spec, candidate) {
      const saved = store(spec, candidate.blueprint);
      if (!saved.startsWith('Mission saved.')) throw new Error(saved);
      fill(mission);
      return mission;
    },
    assemblyChanged() {
      if (field('assembly').value !== 'manual' || !results.length) return;
      invalidate();
      status.textContent = 'Build changed. Recalculate.';
    },
    renderFlight(flight) {
      if(flight && !flight.execution){currentFlight=flight;renderCrew(flight);renderSatellite(null);resultPanel.hidden=true;return;}
      if (currentFlight !== flight && flight) {
        warnings.replaceChildren();
        for (const item of flight.design.checks.filter(item => item.status !== 'PASS')) {
          line('li', `${item.status} · ${item.label}. ${item.reason}`, warnings, item.status);
        }
      }
      currentFlight = flight;
      renderCrew(flight);
      renderSatellite(flight);
      resultPanel.hidden = !flight;
      if (!flight) return;
      const result = flight.execution.result(flight);
      if (result.status !== 'ACTIVE' && !recordedFlights.has(flight)) {
        recordedFlights.add(flight);
        try {
          const library = projects.current();
          const item = library.get(flight.design.spec.id);
          if (item && JSON.stringify(item.spec) === JSON.stringify(flight.design.spec)) {
            library.save({ ...item, result: { status: result.status, elapsedS: flight.totalTime,
              completed: result.objectives.filter(goal => goal.state === 'COMPLETED').length,
              total: result.objectives.length, reason: result.events.findLast(event => event.detail.reason)?.detail.reason ?? '',
              downlinkedMB: flight.satellite?.downlinkedMB ?? null } }, { activate: false });
            projects.refresh();
          }
        } catch (error) { status.textContent = `Result save · ${error.message}`; }
      }
      const key = JSON.stringify(result);
      if (key === lastResult) return;
      lastResult = key;
      resultSummary.textContent = outcomeLabels[result.status];
      goals.replaceChildren();
      for (const item of result.objectives) {
        const evidence = item.evidence;
        const stamp = evidence ? ` · T+${fmt(evidence.seconds)} s` : '';
        const orbit = item.id === 'earth-orbit' && evidence
          ? ` · ${fmt(evidence.periapsisM / 1000)} × ${fmt(evidence.apoapsisM / 1000)} km · ${fmt(evidence.inclinationDeg)}° · period ${fmt(evidence.periodS / 60)} min` : '';
        const data = evidence?.downlinkedMB ?? evidence?.generatedMB;
        const maneuver = evidence?.deltaVMps == null ? '' : ` · Δv ${fmt(evidence.deltaVMps)} m/s · ${fmt(evidence.fuelKg)} kg`;
        const landing = evidence?.landingSpeedMps == null ? '' : ` · ${fmt(evidence.landingSpeedMps)} m/s · crew ${evidence.crew}`;
        line('li', `${stateLabels[item.state]} · ${item.name}${stamp}${orbit}${data == null ? '' : ` · ${fmt(data)} MB`}${maneuver}${landing}`, goals);
      }
    },
  };
}
