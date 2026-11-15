export function physicsSample(p) {
  return {
    simulationTimeS: p.time, xM: p.positionM.x, yM: p.positionM.y, zM: p.positionM.z,
    groundDistanceM: p.groundDistanceM, altitudeM: p.altitudeM,
    vxMps: p.velocityMps.x, vyMps: p.velocityMps.y, vzMps: p.velocityMps.z,
    verticalSpeedMps: p.verticalSpeedMps, horizontalSpeedMps: p.horizontalSpeedMps,
    surfaceSpeedMps: p.surfaceSpeedMps, inertialSpeedMps: p.orbit.inertialSpeedMps,
    accelerationMps2: p.accelerationMps2.length(), properG: p.properG,
    thrustN: p.thrustN, massKg: p.massKg, fuelMassKg: p.fuelMassKg,
    pitchDeg: p.pitch, yawDeg: p.yaw, rollDeg: p.roll, pitchRateDegS: p.pitchRate,
    dynamicPressurePa: p.dynamicPressurePa, stageIndex: p.stageIndex,
    periapsisM: p.orbit.periapsisM, apoapsisM: Number.isFinite(p.orbit.apoapsisM) ? p.orbit.apoapsisM : null,
  };
}
export function trajectoryCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return `${keys.join(',')}\n${rows.map(row => keys.map(key => row[key] ?? '').join(',')).join('\n')}\n`;
}
const plots = [['altitudeM','Altitude','km',.001],['surfaceSpeedMps','Ground-relative speed','m/s',1],['accelerationMps2','Net acceleration','m/s²',1],['groundDistanceM','Ground distance from pad','km',.001]];
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function trajectoryReport(records, name = 'Launch trajectory') {
  const chart = (key, label, unit, scale, rows) => {
    const width = 700, height = 240, margin = 45;
    const maxT = Math.max(1, ...rows.map(row => row.simulationTimeS));
    const low = Math.min(0, ...rows.map(row => row[key] * scale)), high = Math.max(1, ...rows.map(row => row[key] * scale));
    const points = rows.map(row => `${(margin + row.simulationTimeS / maxT * (width - margin - 20)).toFixed(2)},${(height - margin - (row[key] * scale - low) / (high - low) * (height - margin - 30)).toFixed(2)}`).join(' ');
    return `<section><h3>${label} · ${unit}</h3><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><path d="M45 20V195H680" fill="none" stroke="#62717f"/><polyline points="${points}" fill="none" stroke="#aee7ee" stroke-width="1.7"/><text x="45" y="225">0</text><text x="560" y="225">${maxT.toFixed(1)} s</text><text x="4" y="25">${high.toFixed(1)}</text><text x="4" y="195">${low.toFixed(1)}</text></svg></section>`;
  };
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHTML(name)}</title><style>body{margin:35px;background:#101820;color:#e2ebef;font:15px system-ui}h1{font-weight:400}article{margin:40px 0}article>div{display:grid;grid-template-columns:repeat(2,minmax(300px,1fr));gap:20px}section{background:#17232e;padding:15px}h3{font-size:13px;font-weight:400}svg{width:100%;font:11px system-ui;fill:#b7c9d3}@media(max-width:750px){article>div{grid-template-columns:1fr}}</style><h1>${escapeHTML(name)}</h1><p>Integrated force model · SI · Earth-fixed coordinates · ground-relative velocity. These are simulation results, not historical flight data.</p>${Object.entries(records).map(([label, rows]) => `<article><h2>${escapeHTML(label)}</h2><div>${plots.map(args => chart(...args, rows)).join('')}</div></article>`).join('')}</html>`;
}
function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export class FlightDiagnostics {
  constructor(root, getState, getRenderState = () => ({}), actions = {}) {
    this.root = root; this.getState = getState; this.lastDraw = 0;
    this.getRenderState = getRenderState;
    root.innerHTML = `<summary>Physics diagnostics</summary><pre class="physics-values"></pre><canvas class="physics-chart" width="520" height="300" aria-label="Recorded trajectory charts"></canvas><div class="flight-row"><button type="button" class="control" data-export="csv">Export CSV</button><button type="button" class="control" data-export="html">Export charts</button></div><button type="button" class="control" data-engine-fault>Engine failure</button>`;
    this.values = root.querySelector('pre'); this.canvas = root.querySelector('canvas');
    const controls = document.createElement('div'); controls.className = 'flight-row';
    controls.innerHTML = '<button class="control" type="button" data-push-loose>Push loose object</button><button class="control" type="button" data-impact-test>Impact test</button><button class="control" type="button" data-dock-fast>Fast approach</button><button class="control" type="button" data-dock-angle>Docking attitude fault</button>';
    root.append(controls);
    controls.querySelector('[data-push-loose]').addEventListener('click', () => { if (!getState()?.paused) actions.push?.(); });
    controls.querySelector('[data-impact-test]').addEventListener('click', () => { if (!getState()?.paused) actions.impact?.(); });
    controls.querySelector('[data-dock-fast]').addEventListener('click', () => { if (!getState()?.paused) actions.dockFast?.(); });
    controls.querySelector('[data-dock-angle]').addEventListener('click', () => { if (!getState()?.paused) actions.dockAngle?.(); });
    root.addEventListener('click', event => {
      const s = getState(); if (!s) return;
      if (event.target.dataset.export === 'csv') download(trajectoryCSV(s.launch.trajectory), 'text/csv', `${s.id}-trajectory.csv`);
      if (event.target.dataset.export === 'html') download(trajectoryReport({ [s.launch.vehicle.name]: s.launch.trajectory }), 'text/html', `${s.id}-trajectory.html`);
      if (event.target.hasAttribute('data-engine-fault') && s.kind === 'ascent') {
        const engine = s.launch.stages[s.launch.stageIndex];
        if (engine.failed) engine.failed = false;
        else s.launch.failEngine();
      }
    });
  }
  update() {
    if (!this.root.open || performance.now() - this.lastDraw < 200) return;
    this.lastDraw = performance.now();
    const s = this.getState(); if (!s) return;
    const p = s.launch, row = physicsSample(p);
    const rendered = this.getRenderState();
    for (const button of this.root.querySelectorAll('[data-dock-fast],[data-dock-angle]')) button.disabled = s.paused || !rendered.rigid?.dockingActive || rendered.rigid?.joints > 0;
    this.values.dataset.snapshot = JSON.stringify({ physics: row, rendering: rendered });
    this.values.textContent = `ECEF · m / s / kg / N\n${p.vehicle.name}\n${s.kind === 'ascent' || s.kind === 'orbit' ? 'FORCE INTEGRATION' : 'RECORDED LAUNCH · educational mission segment'}\n` + Object.entries(row).map(([key, value]) => `${key}: ${value === null ? 'unbound' : value.toFixed(3)}`).join('\n');
    this.values.textContent += `\nRendering: ${JSON.stringify(rendered)}`;
    const fault = this.root.querySelector('[data-engine-fault]');
    fault.disabled = s.kind !== 'ascent' || s.failed || s.aborted;
    fault.textContent = p.stages[p.stageIndex].failed ? 'Restore engine' : 'Engine failure';
    const c = this.canvas.getContext('2d'), rows = p.trajectory;
    c.clearRect(0, 0, 520, 300); c.font = '11px sans-serif';
    plots.forEach(([key, label, unit, scale], index) => {
      const x = index % 2 * 260, y = Math.floor(index / 2) * 150;
      const max = Math.max(1, ...rows.map(r => r[key] * scale)), end = Math.max(1, p.time);
      c.fillStyle = '#b7c9d3'; c.fillText(`${label} (${unit})`, x + 12, y + 16);
      c.strokeStyle = '#aee7ee'; c.beginPath();
      rows.forEach((r, i) => { const px = x + 12 + r.simulationTimeS / end * 232, py = y + 135 - r[key] * scale / max * 104; if (i) c.lineTo(px, py); else c.moveTo(px, py); });
      c.stroke();
    });
  }
}
