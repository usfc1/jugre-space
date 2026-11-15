import { surfaceConfig } from './surface-expedition.mjs';
import { marsEdlSites, evaluateMarsSite } from './mars-edl-control.mjs';
const surfaceLabels = {
  "ladder": "Ladder / first step",
  "contingency": "Contingency sample",
  "flag": "Flag",
  "seismometer": "Seismometer",
  "reflector": "Laser reflector",
  "foil": "Solar-wind foil",
  "plaque": "Plaque",
  "tv": "TV camera",
  "core0": "Core 1",
  "core1": "Core 2",
  "memorial": "Memorial package",
  "lm": "Return to module",
  "checkpoint": "Return checkpoint",
  "depot": "Three Forks depot",
  "conglomerate": "Conglomerate",
  "sharp": "Mount Sharp",
  "craneDebris": "Descent-stage debris",
  "sample0": "Basalt",
  "sample1": "Breccia",
  "sample2": "Basalt",
  "sample3": "Breccia",
  "sample4": "Basalt",
  "sample5": "Breccia",
  "photo0": "Panorama",
  "photo1": "Bootprint",
  "photo2": "Aldrin",
  "photo3": "Module north",
  "photo4": "Module south",
  "photo5": "Module east",
  "photo6": "Module west",
  "rock0": "Basalt",
  "rock1": "Sedimentary rock",
  "rock2": "Breccia",
  "rock3": "Coronation",
  "rock4": "John Klein",
  "rock5": "Rocknest"
};
const targetName = target => surfaceLabels[target.id] ?? target.title;

export function setupLocalControls(panel, getState, changed) {
  const section = document.createElement('section'); section.id = 'local-controls';
  section.innerHTML = `<strong>Vehicle controls</strong>
    <output id="local-readings" style="white-space:pre-line"></output>
    <div id="lander-actions"><button type="button" data-local="go">1202/1201 · GO</button>
    <button type="button" data-local="abort">NO-GO / abort</button>
    <button type="button" data-local="cutoff">Cut off engine</button></div>
    <button id="lunar-ascent-ignite" type="button" data-local="ignite">Ignite ascent stage</button>
    <div id="mars-edl-actions">
      <button type="button" data-local="parachute">Deploy parachute</button>
      <button type="button" data-local="shield">Jettison heat shield</button>
      <label>Landing site <select id="mars-site"></select></label>
      <button type="button" data-local="site">Confirm site</button>
      <button type="button" data-local="backshell">Jettison backshell</button>
      <button type="button" data-local="cut">Cut cables</button>
    </div>
    <div id="surface-actions"><label>Target <select id="surface-target"></select></label><label>Tool <select id="surface-tool">${['Camera / scoop', 'Laser / tongs', 'Drill / tube', 'Scoop / hammer', 'CheMin / camera', 'SAM / flag'].map((s, i) => `<option value="${i + 1}">${i + 1} · ${s}</option>`).join('')}</select></label>
    <button type="button" data-local="interact">F · Interact</button>
    <button type="button" data-local="aim">Aim at nearest target</button>
    <button type="button" data-local="sun">Point toward the Sun</button><button type="button" data-local="earth">Point toward Earth</button>
    <label>X, m <input id="surface-x" type="number" value="12"></label><label>Z, m <input id="surface-z" type="number" value="0"></label>
    <label>Altitude, m <input id="surface-height" type="number" min="0" max="20" value="3"></label>
    <button type="button" data-local="navigate">Autonomous navigation</button>
    <button type="button" data-local="queue">Queue forward · 2 s</button>
    <button type="button" data-local="hover">Hover / land</button>
    <button type="button" data-local="deploy-helicopter">Deploy Ingenuity</button>
    <button type="button" data-local="dawn">Wait for dawn</button>
    <button type="button" data-local="moxie">Run MOXIE</button><button type="button" data-local="microphone">Record audio</button>
    <button type="button" data-local="finish">Return / finish</button></div>`;
  panel.append(section);
  section.querySelector('#mars-site').replaceChildren(...marsEdlSites.map(([x, z], i) => {
    const site = evaluateMarsSite(i);
    return new Option(`${x}, ${z} m · ${site.safe ? 'safe' : 'unsafe'} · ${site.slopeDeg.toFixed(1)}°`, i);
  }));
  for (const button of section.querySelectorAll('[data-local]')) button.onclick = () => {
    const s = getState(); if (!s || s.paused || s.mode !== 'manual' || s.actualRate > 1) return;
    const emit = (type, detail) => s.report(type, detail, type);
    if (s.kind === 'marsLanding' && s.marsEdl) {
      s.marsEdl.command(button.dataset.local, emit, Number(section.querySelector('#mars-site').value)); changed(); return;
    }
    if (button.dataset.local === 'ignite' && s.localAscent?.ignite(s.time)) emit('lunarAscentIgnition', { windowErrorS: s.time, throttle: 1, massKg: s.localAscent.massKg });
    if (button.dataset.local === 'go') s.localLanding?.choose(true, emit);
    if (button.dataset.local === 'abort') s.localLanding?.choose(false, emit);
    if (button.dataset.local === 'cutoff') {
      s.localLanding?.shutdown();
      if (s.localLanding?.contact) s.report('contactShutdown', { contact: true, thrustN: 0 });
    }
    const e = s.surfaceExpedition;
    if (e) {
      const action = button.dataset.local;
      if (action === 'interact') e.interact(emit);
      if (action === 'aim') { const o = e.nearest(); if (o) { e.aimAt(o); e.current.yaw = e.mastYaw; } }
      if (action === 'sun') e.current.yaw = surfaceConfig.easep.sunAzimuth;
      if (action === 'earth') e.current.yaw = surfaceConfig.easep.earthAzimuth;
      const x = Number(section.querySelector('#surface-x').value), z = Number(section.querySelector('#surface-z').value);
      if (action === 'navigate' && [x, z].every(Number.isFinite)) {
        if (e.current.profile === 'helicopter') e.planFlight([[x, Number(section.querySelector('#surface-height').value), z], [x, 0, z]]);
        else e.autonav = [x, e.height(x, z), z];
      }
      if (action === 'queue') e.enqueue({ drive: 1 });
      if (action === 'hover' && e.current.profile === 'helicopter' && e.current.status === 'flying') { e.current.hover = true; e.current.landing = true; }
      if (action === 'deploy-helicopter') e.deployHelicopter(emit);
      if (action === 'dawn') s.waitSurfaceDawn(emit);
      if (['moxie', 'microphone'].includes(action)) e.roverExperiment(action, emit);
      if (action === 'finish' && (e.returned || e.current.profile === 'rover')) { e.returned = true; s.report('surfaceOperationsComplete', { massKg: e.loadedKg, data: e.analyses.length }); }
    }
    changed();
  };
  section.querySelector('#surface-tool').onchange = event => { const s = getState(); if (s?.surfaceExpedition && !s.paused) s.surfaceExpedition.current.tool = Number(event.target.value); };
  section.querySelector('#surface-target').onchange = event => { const s = getState(); if (s?.surfaceExpedition) s.surfaceExpedition.targetId = event.target.value || null; };
  return { update() {
    const s = getState(), l = s?.localLanding, e = s?.surfaceExpedition, ascent = s?.localAscent && s.kind === 'rendezvous';
    const edl = s?.kind === 'marsLanding' && s.marsEdl;
    const surface = e && ['moonSurface', 'marsSurface'].includes(s.kind);
    section.hidden = !edl && !ascent && !surface && (!l || !['moonLanding', 'marsLanding'].includes(s.kind));
    if (section.hidden) return;
    section.querySelector('#lander-actions').hidden = Boolean(surface || ascent || edl); section.querySelector('#surface-actions').hidden = !surface;
    section.querySelector('#mars-edl-actions').hidden = !edl;
    section.querySelector('#lunar-ascent-ignite').hidden = !ascent;
    if (edl) {
      section.querySelector('#local-readings').textContent = `EDL · ${edl.phase} · ${edl.heightM.toFixed(1)} m · ${edl.speedMps.toFixed(1)} m/s\nRange Trigger · ${(edl.rangeM / 1000).toFixed(2)} km · ${edl.chuteWindow ? 'parachute window open' : 'outside window'}\nFuel ${edl.fuelKg.toFixed(1)} kg · cables ${edl.ropeM.toFixed(2)} m · ${edl.ropeRateMps.toFixed(2)} m/s\n${edl.terrainDeadlineS !== null && edl.selectedSite === null ? 'Select site · ' + Math.max(0, edl.terrainDeadlineS - edl.seconds).toFixed(1) + ' s' : edl.reason}`;
    } else if (ascent) {
      const a = s.localAscent;
      section.querySelector('#local-readings').textContent = `Eagle · ${a.status} · ascent simulation\nFixed thrust · mass ${a.massKg.toFixed(1)} kg, including ${a.sampleKg.toFixed(1)} kg samples\nFuel ${a.fuelKg.toFixed(1)} kg · altitude ${(s.altitude * 1000).toFixed(0)} m\nOrbit ${a.orbit ? `${(a.orbit.periapsisM / 1000).toFixed(1)} × ${(a.orbit.apoapsisM / 1000).toFixed(1)} km` : 'unconfirmed'}\nLaunch window ±60 s from phase start.`;
    } else if (surface) {
      const a = e.current, o = e.nearest(); section.querySelector('#surface-tool').value = a.tool;
      const select = section.querySelector('#surface-target');
      if (select.options.length !== e.objects.length + 1) select.replaceChildren(new Option('Nearest', ''), ...e.objects.map(o => new Option(targetName(o), o.id)));
      select.value = e.targetId ?? '';
      section.querySelector('#local-readings').textContent = `${a.id} · ${a.status} · X ${a.p.x.toFixed(1)} / Z ${a.p.z.toFixed(1)} m\nNearest target · ${o ? targetName(o) : 'all complete'} (${o ? a.p.distanceTo({ x: o.p[0], y: o.p[1], z: o.p[2] }).toFixed(1) : '—'} m)\n`
        + (a.profile === 'astronaut' ? `Suit timer ${Math.ceil(a.remainingS)} s · samples ${(e.sampleKg + e.loadedKg).toFixed(1)} kg · tool ${a.tool}\nF to interact · 5 camera · 6 flag · V to switch`
          : `Energy ${(a.energyJ / 3600).toFixed(1)} Wh · temperature ${a.temperature.toFixed(1)}°C · sample tubes ${a.inventory.length} · wear ${(a.wear * 100).toFixed(1)}% · tilt ${((a.tilt ?? 0) * 180 / Math.PI).toFixed(1)}°\nQueue ${e.queue.length} · command delay ${e.commandDelayS} s · Mars time ${e.solarHour.toFixed(2)} h\nLink ${a.link === false ? 'lost' : 'available'} · drift ${(a.navDriftM ?? 0).toFixed(2)} m · hover ${(a.hoverSeconds ?? 0).toFixed(1)} s.`);
    } else section.querySelector('#local-readings').textContent = `P66 · ${l.status}\nAltitude ${l.p.y.toFixed(1)} m · V↓ ${(-l.v.y).toFixed(1)} m/s · target ${(-l.descentMps).toFixed(1)} m/s\nThrottle ${(l.throttle * 100).toFixed(0)}% · fuel ${l.fuelKg.toFixed(1)} kg · ${l.fuelSeconds.toFixed(0)} s\n${l.contact ? 'Contact · cut off engine' : l.alarm ?? 'Probes clear'}\nTouchdown limits · vertical ≤3 m/s · horizontal ≤1.2 m/s · tilt ≤12°`;
    for (const b of section.querySelectorAll('button')) b.disabled = s.paused || s.mode !== 'manual' || s.actualRate > 1;
    if (edl) {
      section.querySelector('[data-local=parachute]').disabled ||= !edl.chuteWindow;
      section.querySelector('[data-local=shield]').disabled ||= edl.phase !== 'parachute' || !edl.heatshield || edl.speedMps > 200;
      section.querySelector('[data-local=site]').disabled ||= !edl.terrainNavigation || edl.heatshield || edl.selectedSite !== null;
      section.querySelector('[data-local=backshell]').disabled ||= !edl.backshell || edl.heatshield || edl.selectedSite === null || edl.heightM > 2100;
      section.querySelector('[data-local=cut]').disabled ||= edl.phase !== 'contact';
    }
    if (surface) {
      for (const action of ['deploy-helicopter', 'dawn', 'moxie', 'microphone']) section.querySelector('[data-local=' + action + ']').hidden = e.current.id !== 'perseverance';
      section.querySelector('[data-local=deploy-helicopter]').disabled ||= e.ingenuityDeployed;
      section.querySelector('[data-local=hover]').hidden = e.current.profile !== 'helicopter';
    }
  } };
}
