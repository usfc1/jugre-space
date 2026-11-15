// All values are simulation seconds. No wall-clock timers or animation frames.
export class MissionClock {
  constructor(state) {
    this.state = state;
    this.liftoffTime = null;
    this.stoppedAt = null;
  }
  get launched() { return this.liftoffTime !== null; }
  get utc() {
    if(this.state.interplanetary?.departed&&this.state.interplanetary.route.departureUtc)return new Date(Date.parse(this.state.interplanetary.route.departureUtc)+(this.state.totalTime-this.state.interplanetary.epoch)*1000).toISOString();
    const epoch=this.state.mission.history?.launchUtc ?? this.state.interplanetary?.route?.departureUtc;
    return epoch&&this.launched?new Date(Date.parse(epoch)+this.seconds*1000).toISOString():null;
  }
  get seconds() {
    if (this.stoppedAt !== null) return this.stoppedAt;
    return this.launched ? Math.max(0, this.state.totalTime - this.liftoffTime) : -Math.max(0, this.state.countdown);
  }
  launch() { if (!this.launched) this.liftoffTime = this.state.totalTime; }
  stop() { this.stoppedAt = this.seconds; }
  resume() { this.stoppedAt = null; }
  serialize() { return { liftoffTime: this.liftoffTime, stoppedAt: this.stoppedAt }; }
  restore(data) { this.liftoffTime = data.liftoffTime; this.stoppedAt = data.stoppedAt; }
}

export function formatMissionTime(seconds, launched = seconds >= 0) {
  // Ceil countdown, floor elapsed time. Days never wrap after 24 hours.
  const value = Math.max(0, launched ? Math.floor(Math.abs(seconds) + 1e-8) : Math.ceil(Math.abs(seconds) - 1e-8));
  const days = Math.floor(value / 86400);
  const hh = String(Math.floor(value / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor(value / 60) % 60).padStart(2, '0');
  const ss = String(value % 60).padStart(2, '0');
  return `T${launched ? '+' : '−'} ${days ? `${days}d ` : ''}${hh}:${mm}:${ss}`;
}
