import { planRocketManeuver, rocketReadings, sasDirections } from './rocket-control.mjs';

export function setupRocketControls(panel, getState, finish) {
  const section = document.createElement('section');
  section.id = 'rocket-controls';
  section.innerHTML = `<strong>Rocket controls</strong>
    <p class="flight-key-hint"></p>
    <label>SAS <select id="rocket-sas"></select></label>
    <output id="rocket-readings" class="flight-key-hint" style="white-space:pre-line"></output>
    <output id="rocket-warnings" role="status"></output>
    <details><summary>Upper-stage maneuver</summary>
      <label>Delay, s <input id="rocket-node-delay" type="number" min="0" max="86400" value="0"></label>
      <label>Δv, m/s <input id="rocket-node-dv" type="number" min="0.01" max="20000" step="any" value="100"></label>
      <label>Direction <select id="rocket-node-direction"></select></label>
      <button id="rocket-node-plan" type="button" class="control">Plan maneuver</button>
      <button id="rocket-node-arm" type="button" class="control">Arm burn</button>
      <button id="rocket-node-cutoff" type="button" class="control">Cutoff</button>
      <p class="flight-key-hint">Set throttle with Shift or Z. Burn stops at the planned Δv.</p>
    </details>
    <output id="rocket-node-status" role="status"></output>
    <button id="rocket-finish" type="button" class="control">Accept orbit</button>`;
  panel.append(section);
  const get = id => section.querySelector('#' + id);
  get('rocket-sas').replaceChildren(...Object.entries(sasDirections).map(([id, name]) => new Option(name, id)));
  get('rocket-node-direction').replaceChildren(...Object.entries(sasDirections).filter(([id]) => id !== 'hold').map(([id, name]) => new Option(name, id)));
  get('rocket-sas').addEventListener('change', event => {
    const s = getState();
    s.launch.rocketControl.sasMode = event.target.value;
    s.launch.rocketControl.hold = s.launch.thrustDirection.toArray();
    s.manualControl.sas = true;
  });
  get('rocket-node-plan').addEventListener('click', () => {
    try {
      const s = getState();
      planRocketManeuver(s.launch, Number(get('rocket-node-delay').value), Number(get('rocket-node-dv').value), get('rocket-node-direction').value);
      get('rocket-node-status').textContent = 'Maneuver planned';
    } catch (error) { get('rocket-node-status').textContent = error.message; }
  });
  get('rocket-node-arm').addEventListener('click', () => {
    const s = getState(), m = s.launch.rocketControl.maneuver;
    if (m?.status !== 'planned' || s.paused || s.mode !== 'manual') return;
    m.status = 'armed';
    s.manualControl.sas = true;
    s.launch.cutoff = false;
    s.throttle = 0;
  });
  get('rocket-node-cutoff').addEventListener('click', () => {
    const s = getState();
    if (s.paused) return;
    s.throttle = 0;
    const m = s.launch.rocketControl.maneuver;
    if (m?.status === 'armed') m.status = 'cancelled';
  });
  get('rocket-finish').addEventListener('click', finish);
  return {
    update() {
      const s = getState();
      section.hidden = s.kind !== 'ascent' || !s.rocketTest;
      if (section.hidden) return;
      const p = s.launch, r = rocketReadings(p), m = p.rocketControl.maneuver;
      const n = value => Number.isFinite(value) ? value.toFixed(1) : '∞';
      get('rocket-readings').textContent = `Altitude ${n(r.altitudeM / 1000)} km · V↑ ${n(r.verticalMps)} m/s · V→ ${n(r.horizontalMps)} m/s
Q ${n(r.qPa / 1000)} kPa · Proper acceleration ${n(r.properG)} g
Coordinate acceleration ${n(r.accelerationMps2)} m/s²
Apoapsis ${n(r.apoapsisM / 1000)} km · Periapsis ${n(r.periapsisM / 1000)} km
TWR ${n(r.twr)} · Stage Δv ${n(r.deltaVMps)} m/s`;
      get('rocket-warnings').textContent = r.warnings.join(' · ');
      get('rocket-sas').value = p.rocketControl.sasMode;
      get('rocket-sas').disabled = s.paused || s.mode !== 'manual';
      get('rocket-node-arm').disabled = s.paused || s.mode !== 'manual' || m?.status !== 'planned';
      if (m) get('rocket-node-status').textContent = `${m.status} · Burn in ${n(Math.max(0, m.startS - p.time))} s · Remaining Δv ${n(Math.max(0, m.deltaVMps - m.deliveredMps))} m/s`;
      const target = s.execution?.plan.target;
      const peri = target?.periapsisM ?? p.vehicle.guidance.targetAltitudeM;
      const apo = target?.apoapsisM ?? peri;
      const tolerance = target?.toleranceM ?? 10000;
      get('rocket-finish').disabled = s.paused || p.orbit.energy >= 0
        || Math.abs(p.orbit.periapsisM - peri) > tolerance || Math.abs(p.orbit.apoapsisM - apo) > tolerance;
    },
  };
}
