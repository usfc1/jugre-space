const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const timeLabel = seconds => {
  const absolute = Math.abs(seconds);
  if (absolute >= 86400) return `${number.format(seconds / 86400)} d`;
  if (absolute >= 3600) return `${number.format(seconds / 3600)} h`;
  if (absolute >= 60) return `${number.format(seconds / 60)} min`;
  return `${number.format(seconds)} s`;
};

export const journalMetrics = [
  ['altitude', 'Altitude', 'km'], ['speed', 'Speed', 'km/s'],
  ['acceleration', 'Acceleration', 'm/s²'], ['gforce', 'G-force', 'g'],
  ['fuel', 'Fuel', '%'], ['pitch', 'Pitch', '°'], ['roll', 'Roll', '°'],
  ['pressure', 'Dynamic pressure', 'kPa'], ['heat', 'Engine heat', '%'],
  ['hull', 'Hull integrity', '%'], ['link', 'Radio link', '1 = linked'],
  ['cabin', 'Cabin pressure', 'kPa'], ['modules', 'Damaged modules', 'count'],
  ['oxygen', 'Oxygen', 'kg', 'life'], ['reserve', 'Oxygen reserve', 'kg', 'life'],
  ['co2', 'CO₂ pressure', 'Pa', 'life'], ['temperature', 'Cabin temperature', '°C', 'life'],
  ['humidity', 'Humidity', '%', 'life'], ['battery', 'Battery', 'kWh', 'life'],
  ['power', 'Electrical load', 'W', 'life'], ['water', 'Water', 'kg', 'life'],
  ['food', 'Food', 'kg', 'life'], ['leak', 'Cabin leak', 'g/s', 'life'],
];

// Keep the complete flight interval while bounding memory during long missions.
export class TelemetryHistory {
  constructor(limit = 1024) { this.limit = limit; this.rows = []; }
  add(row) {
    if (!Number.isFinite(row.time)) return;
    const previous = this.rows.at(-1);
    if (previous && row.time < previous.time) this.rows = [];
    if (previous && row.time === previous.time) { this.rows[this.rows.length - 1] = row; return; }
    if (this.rows.length >= this.limit) this.rows = this.rows.filter((_, index) => index % 2 === 0);
    this.rows.push(row);
  }
}

function drawChart(canvas, rows, key, unit, horizontal = 'time') {
  const context = canvas.getContext('2d');
  const width = canvas.width, height = canvas.height;
  const points = rows.filter(row => Number.isFinite(row[key]) && Number.isFinite(row[horizontal]));
  context.clearRect(0, 0, width, height);
  context.font = '11px "Segoe UI", sans-serif';
  const left = 60, right = width - 16, top = 16, bottom = height - 31;
  context.fillStyle = '#96aec3';
  if (!points.length) { context.fillText('Awaiting telemetry', left, height / 2); canvas.dataset.samples = '0'; return; }
  const values = points.map(row => row[key]);
  const minimum = Math.min(...values), maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * .08, Math.abs(maximum) * .02, .01);
  const low = minimum - padding, high = maximum + padding;
  const coordinates = points.map(row => row[horizontal]);
  const start = Math.min(...coordinates), end = Math.max(start + .001, ...coordinates);
  for (let i = 0; i < 4; i++) {
    const y = top + (bottom - top) * i / 3;
    context.strokeStyle = '#91b9d21f';
    context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
    context.fillText(number.format(high - (high - low) * i / 3), 4, y + 4, left - 9);
  }
  context.strokeStyle = '#8ce9ff'; context.lineWidth = 2;
  context.beginPath();
  points.forEach((row, index) => {
    const x = left + (row[horizontal] - start) / (end - start) * (right - left);
    const y = bottom - (row[key] - low) / (high - low) * (bottom - top);
    if (index) context.lineTo(x, y); else context.moveTo(x, y);
  });
  context.stroke();
  const last = points.at(-1);
  const x = left + (last[horizontal] - start) / (end - start) * (right - left);
  const y = bottom - (last[key] - low) / (high - low) * (bottom - top);
  context.fillStyle = '#ceff85'; context.beginPath(); context.arc(x, y, 3, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#96aec3';
  const useMeters = horizontal !== 'time' && end < 1;
  const axis = value => horizontal === 'time' ? timeLabel(value)
    : useMeters ? `${number.format(value * 1000)} m` : `${number.format(value)} km`;
  context.fillText(axis(start), left, height - 9);
  context.textAlign = 'right'; context.fillText(axis(end), right, height - 9); context.textAlign = 'left';
  canvas.dataset.samples = String(points.length);
  canvas.setAttribute('aria-label', `${canvas.dataset.title}. ${points.length} samples. Latest ${number.format(last[key])} ${unit}.`);
}

const eventLabel = type => ({
  liftoff: 'Liftoff', maxQ: 'Max Q passed', stage: 'Stage separation',
  boostersSeparated: 'Booster separation', engineCutoff: 'Engine cutoff',
  orbitInsertion: 'Orbit confirmed', success: 'Mission complete',
  expeditionRecovery: 'Recovery complete', expeditionEntry: 'Earth entry',
  expeditionReturn: 'Earth-return burn', expeditionCapture: 'Lunar capture',
  expeditionArrival: 'Lunar arrival', expeditionTli: 'Translunar injection',
}[type] ?? type.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase()));

export class FlightJournal {
  constructor(dialog, clearInput) {
    this.dialog = dialog;
    this.clearInput = clearInput;
    this.feed = dialog.querySelector('#journal-events');
    this.grid = dialog.querySelector('#journal-charts');
    this.history = new TelemetryHistory();
    this.entries = [];
    this.charts = new Map();
    this.lastPaint = 0;
    for (const [key, title, unit, group] of journalMetrics) {
      const card = document.createElement('article');
      card.className = 'journal-chart'; card.id = `journal-chart-${key}`;
      card.dataset.group = group ?? 'flight';
      const heading = document.createElement('h3'); heading.textContent = title;
      const value = document.createElement('output');
      const canvas = document.createElement('canvas');
      canvas.width = 460; canvas.height = 180; canvas.dataset.title = title;
      canvas.setAttribute('role', 'img');
      card.append(heading, value, canvas); this.grid.append(card);
      this.charts.set(key, { card, value, canvas, unit, group });
    }
    const trajectory = dialog.querySelector('#journal-trajectory');
    trajectory.dataset.title = 'Altitude versus ground distance';
    dialog.querySelector('#journal-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      this.clearInput();
      document.querySelector('#viewport').focus({ preventScroll: true });
    });
    new ResizeObserver(() => { if (dialog.open) this.render(); }).observe(this.grid);
  }
  bind(state) {
    this.state = state;
    this.entries = [];
    this.history = new TelemetryHistory();
    this.seen = new Map();
    this.dirty = true;
    for (const row of state.launch.trajectory) {
      this.history.add({ time: row.simulationTimeS, altitude: row.altitudeM / 1000,
        distance: row.groundDistanceM / 1000, speed: row.surfaceSpeedMps / 1000,
        acceleration: row.accelerationMps2, gforce: row.properG,
        pressure: row.dynamicPressurePa / 1000, pitch: row.pitchDeg, roll: row.rollDeg });
    }
    for (const event of state.execution?.events ?? []) this.record(event.type, event.seconds);
    this.revision = -1; this.lastSample = -Infinity;
    this.syncTimeline();
  }
  record(type, seconds = this.state?.timeline.clock.seconds ?? 0) {
    if (type === 'count') return;
    const label = eventLabel(type);
    const previous = this.entries.at(-1);
    if (previous?.label === label && previous.time === seconds) return;
    this.entries.push({ label, time: seconds });
    if (this.entries.length > 600) this.entries.shift();
    this.dirty = true;
  }
  syncTimeline() {
    if (this.revision === this.state.timeline.revision) return;
    this.revision = this.state.timeline.revision;
    for (const event of this.state.timeline.events) {
      if (!['COMPLETE', 'FAILED', 'SKIPPED'].includes(event.status)) continue;
      if (this.seen.get(event.id) === event.status) continue;
      this.seen.set(event.id, event.status);
      this.record(`${event.label} · ${event.status.toLowerCase()}`, event.actualTime ?? this.state.timeline.clock.seconds);
    }
  }
  update(state, altitude, pitch) {
    if (state !== this.state) this.bind(state);
    this.syncTimeline();
    const now = performance.now();
    if (now - this.lastSample >= 500 || state.complete || state.failed) {
      this.lastSample = now;
      const life = state.lifeSupport, air = life?.reading();
      this.history.add({ time: state.timeline.clock.seconds, altitude, speed: state.speed / 1000,
        acceleration: state.acceleration, gforce: state.gForce, fuel: state.fuel,
        pitch, roll: state.roll % 360, pressure: state.systems.pressure,
        heat: state.systems.temperature * 100, hull: state.systems.integrity * 100,
        link: Number(state.systems.link), modules: Object.keys(state.systems.moduleDamage).length,
        cabin: state.crew ? state.systems.cabinPressureKPa : null,
        oxygen: life?.oxygenKg, reserve: life?.reserveKg, co2: air?.partialPa.co2,
        temperature: air ? air.temperatureK - 273.15 : null, humidity: air ? air.humidity * 100 : null,
        battery: life ? life.batteryJ / 3600000 : null, power: life?.powerW,
        water: life?.waterKg, food: life?.foodKg, leak: life ? life.leakKgS * 1000 : null });
    }
    if (this.dialog.open && now - this.lastPaint >= 500) this.render();
  }
  open(key) {
    this.clearInput();
    if (!this.dialog.open) this.dialog.showModal();
    this.render();
    if (key) this.charts.get(key)?.card.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  close() { this.dialog.close(); }
  render() {
    if (!this.state) return;
    this.lastPaint = performance.now();
    this.dialog.querySelector('#journal-mission').textContent = this.state.mission.title.replace(/^\d+ · /, '');
    this.dialog.querySelector('#journal-time').textContent = `T${this.state.timeline.clock.seconds < 0 ? '−' : '+'} ${timeLabel(Math.abs(this.state.timeline.clock.seconds))}`;
    if (this.dirty) {
      const fragment = document.createDocumentFragment();
      for (const entry of [...this.entries].sort((a, b) => b.time - a.time)) {
        const row = document.createElement('li');
        const stamp = document.createElement('time'); stamp.textContent = `T${entry.time < 0 ? '−' : '+'} ${timeLabel(Math.abs(entry.time))}`;
        const title = document.createElement('span'); title.textContent = entry.label;
        row.append(stamp, title); fragment.append(row);
      }
      this.feed.replaceChildren(fragment); this.dirty = false;
    }
    this.dialog.querySelector('#journal-empty').hidden = this.entries.length > 0;
    const rows = this.history.rows;
    for (const [key, chart] of this.charts) {
      chart.card.hidden = chart.group === 'life' && !this.state.lifeSupport;
      if (chart.card.hidden) continue;
      const value = rows.at(-1)?.[key];
      chart.value.textContent = Number.isFinite(value) ? `${number.format(value)} ${chart.unit}` : '—';
      drawChart(chart.canvas, rows, key, chart.unit);
    }
    const ascent = this.state.launch.trajectory;
    const path = ascent.filter((_, index) => index % Math.max(1, Math.ceil(ascent.length / 720)) === 0 || index === ascent.length - 1)
      .map(row => ({ altitude: row.altitudeM / 1000, distance: row.groundDistanceM / 1000 }));
    drawChart(this.dialog.querySelector('#journal-trajectory'), path, 'altitude', 'km', 'distance');
  }
}
