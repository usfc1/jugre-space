import { formatMissionTime } from './mission-clock.mjs';
import { shortenedSpaceScale } from './short-flight.mjs';

const put = (element, text) => { if (element.textContent !== text) element.textContent = text; };
const time = value => value === null ? '—' : formatMissionTime(value, value >= 0);

export class TimelineRenderer {
  constructor(root, { details, live, windowSize = 6 } = {}) {
    this.root = root;
    this.details = details;
    this.live = live;
    this.windowSize = windowSize;
    this.offset = null;
    this.key = '';
    this.lastRevision = -1;
    root.innerHTML = `
      <div class="broadcast-rail" aria-label="Mission timeline"><div class="broadcast-line"></div><div class="broadcast-progress"></div><div class="broadcast-markers"></div></div>
      <div class="broadcast-bottom">
        <div class="broadcast-metric"><span>VELOCITY</span><div><output data-broadcast="velocity">0</output><small> KM/H</small></div></div>
        <div class="broadcast-clock"><div class="broadcast-state" data-broadcast="status"></div><output data-broadcast="clock" aria-label="Mission time">T− 00:00:10</output><div class="broadcast-mission" data-broadcast="mission"></div></div>
        <div class="broadcast-metric broadcast-altitude"><span>ALTITUDE</span><div><output data-broadcast="altitude">0.0</output><small> KM</small></div></div>
      </div>
      <div class="broadcast-footnote"><span data-broadcast="segment"></span><span data-broadcast="basis">SIMULATION TIME</span></div>`;
    this.fields = Object.fromEntries([...root.querySelectorAll('[data-broadcast]')].map(el => [el.dataset.broadcast, el]));
    this.markers = root.querySelector('.broadcast-markers');
    this.progress = root.querySelector('.broadcast-progress');
    this.click = e => {
      const button = e.target.closest('[data-timeline-event]');
      if (button) { this.selected = button.dataset.timelineEvent; this.showDetails(); }
    };
    this.markers.addEventListener('click', this.click);
  }
  bind(manager) {
    this.manager = manager;
    this.key = '';
    this.offset = null;
    this.selected = null;
    this.lastRevision = -1;
    this.render();
  }
  setVisible(visible) { this.root.hidden = !visible; }
  autoOffset() {
    const current = this.manager.events.indexOf(this.manager.current);
    return current < this.windowSize - 1 ? 0 : Math.max(0, Math.min(current - 1, this.manager.events.length - this.windowSize));
  }
  navigate(direction) {
    if (!this.manager) return;
    this.offset = direction === 0 ? null : Math.max(0, Math.min(this.manager.events.length - this.windowSize, (this.offset ?? this.autoOffset()) + direction * (this.windowSize - 1)));
    this.key = '';
    this.render();
  }
  zoom(size) { this.windowSize = Math.max(3, Math.min(12, Number(size))); this.offset = null; this.key = ''; this.render(); }
  showDetails() {
    if (!this.details || !this.manager) return;
    const e = this.manager.events.find(e => e.id === this.selected) ?? this.manager.current;
    if (!e) return;
    const historical = e.historicalDate ?? (e.historicalTime === null ? 'unverified' : time(e.historicalTime));
    put(this.details, `${e.label} · ${e.status}\n${e.description}\nPlanned ${time(e.expectedTime)} · Forecast ${time(this.manager.expected(e))}\nActual ${time(e.actualTime)} · Historical ${historical}${e.timePrecision==='approximate'?' · approximate':''}${e.reason ? `\nReason ${e.reason}` : ''}`);
  }
  render() {
    const m = this.manager;
    if (!m || this.root.hidden) return;
    const s = m.flight;
    const start = this.offset ?? this.autoOffset();
    const visible = m.events.slice(start, start + this.windowSize);
    const key = visible.map(e => `${e.id}:${e.status}`).join('|');
    if (key !== this.key) {
      const focusId = this.root.ownerDocument.activeElement?.dataset.timelineEvent;
      const nodes = visible.map((e, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'broadcast-marker';
        button.dataset.timelineEvent = e.id;
        button.dataset.status = e.status;
        button.style.left = `${6 + i / Math.max(1, visible.length - 1) * 88}%`;
        if (e === m.current) button.setAttribute('aria-current', 'step');
        button.setAttribute('aria-label', `${e.label}: ${e.status}`);
        const label = document.createElement('span');
        label.className = 'broadcast-label'; label.textContent = e.label;
        const dot = document.createElement('i'); dot.className = 'broadcast-dot';
        const state = document.createElement('span'); state.className = 'broadcast-event-state'; state.textContent = e.status === 'ACTIVE' ? 'NEXT' : e.status === 'PENDING' ? '' : e.status;
        button.append(label, dot, state);
        return button;
      });
      this.markers.replaceChildren(...nodes);
      if (focusId) nodes.find(n => n.dataset.timelineEvent === focusId)?.focus({ preventScroll: true });
      this.key = key;
    }
    for (const [index, button] of [...this.markers.children].entries()) {
      const e = visible[index];
      button.title = `${e.label} · ${e.status}\n${e.description}\nPlanned ${time(e.expectedTime)}\nForecast ${time(m.expected(e))}\nActual ${time(e.actualTime)}${e.historicalDate ? `\nHistorical date${e.historicalDate}` : ''}`;
    }
    let cursor = -1;
    for (let i = 0; i < visible.length; i++) if (visible[i].status === 'COMPLETE') cursor = i;
    let position = 0;
    if (cursor >= 0) {
      const from = visible[cursor];
      const next = visible[cursor + 1];
      const expected = next ? m.expected(next) : null;
      const fraction = expected !== null && expected > from.actualTime ? Math.max(0, Math.min(.94, (m.clock.seconds - from.actualTime) / (expected - from.actualTime))) : 0;
      position = 6 + (cursor + (next ? fraction : 0)) / Math.max(1, visible.length - 1) * 88;
    }
    this.progress.style.width = `${Math.min(100, position)}%`;
    put(this.fields.clock, formatMissionTime(m.clock.seconds, m.clock.launched));
    put(this.fields.mission, m.config.title.toUpperCase());
    put(this.fields.status, m.status.state);
    this.root.dataset.missionStatus = m.status.state;
    put(this.fields.velocity, Math.round(s.speed * 3.6).toLocaleString('en-US'));
    put(this.fields.altitude, (Math.max(0, s.altitude) * shortenedSpaceScale(s)).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    const reference=s.speedReference==='sun-inertial'?'HELIOCENTRIC':s.speedReference?.endsWith('-relative')?s.speedReference.toUpperCase():s.speedReference==='earth-inertial'?'EARTH INERTIAL':'EARTH-FIXED';
    put(this.fields.basis, s.flightLength === 'short' || s.interplanetary?.departed ? `CALCULATED MISSION TIME · ${reference} VELOCITY`
      : s.path?.physical ? `PHYSICAL TIME · ${reference} VELOCITY · ×${s.actualRate}` : ['ascent','orbit'].includes(s.kind) ? `PHYSICAL FLIGHT · EARTH-FIXED VELOCITY · ×${s.actualRate}` : 'MISSION TIME · APPROXIMATE OPERATIONS');
    const phases = [...new Set(visible.map(e => e.phase))];
    put(this.fields.segment, phases.length === 1 ? phases[0].replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase() : `MISSION TIMELINE · ${start + 1}—${start + visible.length} / ${m.events.length}`);
    if (this.lastRevision !== m.revision) {
      this.showDetails();
      this.lastRevision = m.revision;
    }
    if (this.live) put(this.live, `${m.status.state}. ${m.current?.label ?? ''}. ${m.current?.status ?? ''}`);
  }
  dispose() { this.markers.removeEventListener('click', this.click); this.manager = null; }
}
