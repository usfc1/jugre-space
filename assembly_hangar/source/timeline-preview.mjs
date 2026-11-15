import { FlightState, missions, customMission } from './flight-missions.mjs';
import { TimelineRenderer } from './timeline-renderer.mjs';

// Explicit test fixtures. This entry point is never loaded by the game.
document.body.innerHTML = `<main id="viewport"><div class="qa-label">HUD TEST MODE · SYNTHETIC FIXTURES</div><section id="broadcast-hud" aria-label="Mission Timeline preview"></section></main>
<aside class="qa-controls"><label>Mission <select id="qa-mission"></select></label><label>State <select id="qa-state">${['COUNTDOWN','HOLD','LIVE','PAUSED','STAGING','DOCKING','LANDING','FAILED','ABORTED','SKIPPED','COMPLETE','MULTIDAY'].map(s => `<option>${s}</option>`).join('')}</select></label><label>Scale <select id="qa-zoom"><option>4</option><option selected>6</option><option>8</option></select></label><button id="qa-toggle">HUD ON / OFF</button><button id="qa-prev">←</button><button id="qa-auto">AUTO</button><button id="qa-next">→</button><pre id="qa-details"></pre></aside>`;
const select = document.querySelector('#qa-mission');
for (const [id, mission] of [...Object.entries(missions), ['custom', customMission]]) {
  const option = document.createElement('option'); option.value = id; option.textContent = mission.title; select.append(option);
}
const renderer = new TimelineRenderer(document.querySelector('#broadcast-hud'), { details: document.querySelector('#qa-details') });
function fixture(name = document.querySelector('#qa-state').value, id = select.value) {
  const flight = new FlightState(id);
  const m = flight.timeline;
  const phaseName = name === 'DOCKING' ? 'docking' : name === 'LANDING' ? 'marsLanding' : null;
  if (phaseName) flight.phaseIndex = Math.max(0, flight.mission.phases.findIndex(p => p.kind === phaseName));
  if (!['COUNTDOWN','HOLD','ABORTED'].includes(name)) {
    flight.preflight = flight.countdown = 0;
    m.clock.liftoffTime = 0;
    flight.totalTime = name === 'MULTIDAY' ? 385 * 86400 + 5432 : name === 'STAGING' ? 148 : 15;
    flight.speed = 1250; flight.altitude = 13.7;
    const index = phaseName ? m.events.findIndex(e => e.phase === phaseName) : name === 'STAGING' ? 4 : 2;
    m.events.forEach((e, i) => { e.status = i < index ? 'COMPLETE' : i === index ? 'ACTIVE' : 'PENDING'; e.actualTime = i < index ? i * 5 : null; });
  }
  if (name === 'HOLD') { flight.preflight = 0; flight.holding = true; flight.countdown = 6; }
  if (name === 'COUNTDOWN') flight.preflight = 0;
  if (name === 'PAUSED') flight.paused = true;
  if (name === 'ABORTED') flight.abort();
  if (name === 'FAILED') flight.fail('structure');
  if (name === 'SKIPPED') m.events[1].status = 'SKIPPED';
  if (name === 'COMPLETE') { flight.complete = true; m.events.forEach(e => { e.status = 'COMPLETE'; e.actualTime = 15; }); }
  m.status.update(flight, m.clock, m.events);
  renderer.bind(m);
  return flight;
}
select.addEventListener('change', () => fixture());
document.querySelector('#qa-state').addEventListener('change', () => fixture());
document.querySelector('#qa-zoom').addEventListener('change', e => renderer.zoom(e.target.value));
document.querySelector('#qa-toggle').addEventListener('click', () => { renderer.setVisible(renderer.root.hidden); renderer.render(); });
document.querySelector('#qa-prev').addEventListener('click', () => renderer.navigate(-1));
document.querySelector('#qa-next').addEventListener('click', () => renderer.navigate(1));
document.querySelector('#qa-auto').addEventListener('click', () => renderer.navigate(0));
window.hudPreview = { fixture, renderer };
fixture();
