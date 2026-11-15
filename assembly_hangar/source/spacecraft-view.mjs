import { defaultSpacecraft, instrumentCategories, instruments, readSpacecraft, spacecraftParts, spacecraftTotals } from './spacecraft-design.mjs';

const get = id => document.getElementById(id);
const enabled = type => ['science', 'deployment'].includes(type);

export function setupSpacecraftDesigner(field, fmt) {
  const panel = get('design-spacecraft');
  const list = get('design-instruments');
  const search = get('design-instrument-search');
  const category = get('design-instrument-category');
  const sort = get('design-instrument-sort');
  const total = get('design-spacecraft-total');
  const numbers = ['budgetM', 'downlinkGoalMB', 'targetLatDeg', 'targetLonDeg'];
  const selected = new Set();
  for (const [name, options] of Object.entries(spacecraftParts)) {
    for (const [id, item] of Object.entries(options)) field(name).add(new Option(item.name, id));
  }
  for (const [id, label] of Object.entries(instrumentCategories)) category.add(new Option(label, id));

  function read() {
    if (!enabled(field('type').value)) return null;
    const values = Object.fromEntries(Object.keys(spacecraftParts).map(name => [name, field(name).value]));
    for (const name of numbers) values[name] = field(name).value === '' ? null : field(name).valueAsNumber;
    return readSpacecraft({ ...values, instrumentIds: Object.keys(instruments).filter(id => selected.has(id)) });
  }

  function update() {
    panel.hidden = !enabled(field('type').value);
    if (panel.hidden) return;
    try {
      const spec = spacecraftTotals(read());
      total.textContent = `${fmt(spec.massKg)}  kg · ${fmt(spec.costM)} M · up to ${fmt(spec.peakW)} W · ${fmt(spec.peakDataMBs)} MB/s · ${spec.scienceValue} points · selected ${selected.size}`;
    } catch (error) { total.textContent = error.message; }
  }

  function renderCatalog() {
    const query = search.value.trim().toLocaleLowerCase('ru');
    const choices = Object.values(instruments).filter(item => (!category.value || category.value === item.category)
      && `${item.name} ${item.purpose}`.toLocaleLowerCase('ru').includes(query));
    choices.sort(sort.value === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ru') : (a, b) => a[sort.value] - b[sort.value]);
    list.replaceChildren();
    for (const item of choices) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      Object.assign(input, { type: 'checkbox', checked: selected.has(item.id) });
      input.dataset.instrument = item.id;
      const title = document.createElement('span');
      title.textContent = item.name;
      const detail = document.createElement('small');
      detail.textContent = `${item.purpose} · ${item.massKg}  kg · ${item.dimensionsM.join(' × ')} m · ${fmt(item.costM)} M · ${item.peakW}/${item.activeW}/${item.standbyW} W (peak/active/standby) · ${fmt(item.rateMBs)} MB/s · ${fmt(item.pointingDeg)}° · ${item.scienceValue} points${item.orbitSupported ? '' : ' · unsupported profile'}`;
      title.append(detail);
      label.append(input, title);
      list.append(label);
    }
    if (!choices.length) list.textContent = 'No matching instruments.';
  }

  for (const element of [search, category, sort]) element.addEventListener('input', renderCatalog);
  // Update before the form handler reads and invalidates the report.
  list.addEventListener('input', event => {
    const input = event.target;
    if (input.checked) selected.add(input.dataset.instrument);
    else selected.delete(input.dataset.instrument);
  });

  return { read, update, fill(spec) {
    const config = spec.spacecraft ?? defaultSpacecraft;
    selected.clear();
    for (const id of config.instrumentIds) selected.add(id);
    for (const name of [...Object.keys(spacecraftParts), ...numbers]) field(name).value = config[name] ?? '';
    panel.open = enabled(spec.type);
    renderCatalog();
    update();
  }, filterInput: target => [search, category, sort].includes(target) };
}

export function setupSatelliteTelemetry(fmt) {
  const panel = get('satellite-panel');
  const reading = get('satellite-readings');
  const chart = get('satellite-chart');
  const ctx = chart.getContext('2d');
  const science = get('satellite-science');
  const radio = get('satellite-radio');
  const instrument = get('satellite-instrument');
  const queue = get('satellite-queue');
  const forecast = get('satellite-forecast');
  const windows = get('satellite-windows');
  const status = get('satellite-command-status');
  let flight;
  let lastHistory;
  let lastForecast = null;

  function command(action, value) {
    try { flight.commandSatellite(action, value); status.textContent = ''; }
    catch (error) { status.textContent = error.message; }
  }
  science.addEventListener('change', () => command('scienceEnabled', science.checked));
  radio.addEventListener('change', () => command('radioEnabled', radio.checked));
  queue.addEventListener('click', () => command('queue', instrument.value));

  function plot(satellite) {
    if (!ctx || lastHistory === satellite.history.at(-1)) return;
    lastHistory = satellite.history.at(-1);
    ctx.clearRect(0, 0, chart.width, chart.height);
    for (const [axis, color, max] of [[1, '#81d7f5', satellite.design.battery.capacityWh], [2, '#efce75', satellite.design.peakW]]) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      const startS = (lastHistory?.[0] ?? 0) - 3600;
      satellite.history.forEach((sample, i) => {
        const x = (sample[0] - startS) / 3600 * (chart.width - 2);
        const y = (1 - sample[axis] / max) * (chart.height - 5) + 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  return function render(current) {
    const satellite = current?.satellite;
    panel.hidden = !satellite;
    if (flight !== current) {
      flight = current;
      lastHistory = null;
      lastForecast = null;
      windows.replaceChildren();
      status.textContent = '';
      instrument.replaceChildren(...(satellite?.design.selected ?? []).map(item => new Option(item.name, item.id)));
    }
    if (!satellite) return;
    const active = !current.complete && !current.failed && !current.aborted;
    science.checked = satellite.scienceEnabled;
    radio.checked = satellite.radioEnabled;
    science.disabled = radio.disabled = !active;
    queue.disabled = instrument.disabled = !active || !satellite.design.selected.length;
    const text = [satellite.reason,
      `Battery ${fmt(satellite.batteryWh)} / ${fmt(satellite.design.battery.capacityWh)} Wh · power ${fmt(satellite.solarW)} W · load ${fmt(satellite.loadW)} W${satellite.eclipsed ? ' · eclipse' : ''}`,
      `Storage ${fmt(satellite.storedMB)} / ${fmt(satellite.design.computer.storageMB)} MB · free ${fmt(satellite.design.computer.storageMB - satellite.storedMB)} MB`,
      `Collected ${fmt(satellite.generatedMB)} · downlinked ${fmt(satellite.downlinkedMB)} / ${fmt(satellite.config.downlinkGoalMB)} · lost ${fmt(satellite.lostMB)} MB`,
      satellite.contact ? `${satellite.contact.name} · ${fmt(satellite.contact.elevationDeg)}° · up to ${fmt(satellite.contact.rateMBs)} MB/s` : 'No ground station in range',
      `Queued tasks ${satellite.queue.length}`].join('\n');
    if (reading.textContent !== text) reading.textContent = text;
    if (panel.open) plot(satellite);
    const forecastKey = satellite.orbit ? Math.floor(satellite.integratedS / 120) : -1;
    if (panel.open && forecast.open && lastForecast !== forecastKey) {
      lastForecast = forecastKey;
      const events = satellite.forecast();
      windows.replaceChildren();
      for (const item of events.length ? events : [{ name: satellite.orbit ? 'No contact windows' : 'Awaiting separation' }]) {
        const li = document.createElement('li');
        li.textContent = item.startS == null ? item.name : `${item.name} · T+${fmt(item.startS / 60)}–${fmt(item.endS / 60)} min`;
        windows.append(li);
      }
    }
  };
}
