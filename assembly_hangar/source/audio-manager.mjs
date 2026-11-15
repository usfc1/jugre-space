import { radioFor, radioLines, speakers } from './mission-radio.mjs';
import { makeSoundBank } from './sound-bank.mjs';

export const audioDefaults = { master: .80, effects: .75, voices: .86, music: .22, interface: .48, subtitles: true };
const storageKey = 'jugre.audio.v1';
const clock = () => performance.now() / 1000;
const bounded = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

export class AudioManager {
  constructor({ voiceData = () => null, subtitle = () => {}, storage, now = clock } = {}) {
    this.voiceData = voiceData;
    this.subtitle = subtitle;
    this.storage = storage;
    this.now = now;
    this.settings = { ...audioDefaults };
    try {
      const saved = JSON.parse(storage?.getItem(storageKey) ?? '{}') ?? {};
      for (const [key, fallback] of Object.entries(audioDefaults)) {
        if (key === 'subtitles') this.settings[key] = typeof saved[key] === 'boolean' ? saved[key] : fallback;
        else this.settings[key] = bounded(saved[key], fallback);
      }
    } catch { /* Storage may be unavailable on a local file. */ }
    this.voices = new Map();
    this.effects = new Set();
    this.loops = new Map();
    this.targets = new WeakMap();
    this.queue = [];
    this.order = 0;
    this.mixState = { density: 0, pressure: 0, distance: 0, pan: 0, cabin: false, engine: 0 };
  }

  async unlock() {
    try {
      if (!this.context) this.setup();
      if (this.context?.state !== 'running') await this.context?.resume();
    } catch { /* A blocked audio device leaves translated captions operational. */ }
  }

  setup() {
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Audio) return;
    const context = this.context = new Audio();
    const gain = (target, volume = 1) => {
      const node = context.createGain();
      node.gain.value = volume;
      node.connect(target);
      return node;
    };
    const filter = (target, type, hz) => {
      const node = context.createBiquadFilter();
      node.type = type;
      node.frequency.value = hz;
      node.Q.value = .68;
      node.connect(target);
      return node;
    };
    const limit = context.createDynamicsCompressor();
    limit.threshold.value = -6;
    limit.knee.value = 12;
    limit.ratio.value = 4;
    limit.connect(context.destination);
    const master = gain(limit);
    const effects = gain(master);
    const voices = gain(master);
    const music = gain(master);
    const ui = gain(master);
    this.channels = { master, effects, voices, music, interface: ui };
    this.musicBed = gain(music, 1);
    this.outside = gain(effects, 0);
    this.panner = context.createStereoPanner?.();
    this.panner?.connect(this.outside);
    this.exteriorAir = filter(this.panner ?? this.outside, 'lowpass', 4400);
    this.inside = gain(effects, 0);
    this.interiorStructure = filter(this.inside, 'lowpass', 480);
    this.radio = filter(filter(voices, 'lowpass', 3060), 'highpass', 290);
    this.soundBank = makeSoundBank(context);
    this.applySettings();
    this.preload = this.loadVoices();
  }

  async loadVoices() {
    const entries = Object.keys(radioLines);
    for (let i = 0; i < entries.length; i += 8) {
      await Promise.all(entries.slice(i, i + 8).map(async (id) => {
        try {
          const bytes = this.voiceData(id);
          if (bytes?.byteLength) this.voices.set(id, await this.context.decodeAudioData(bytes));
        } catch { /* Keep the subtitle if an optional recording fails to decode. */ }
      }));
    }
  }

  prepare() { return this.preload ?? Promise.resolve(); }

  param(parameter, target, tau = .05) {
    if (!parameter) return;
    if (this.targets.get(parameter) === target) return;
    this.targets.set(parameter, target);
    const now = this.context.currentTime;
    parameter.cancelScheduledValues(now);
    if (tau === 0) parameter.setValueAtTime(target, now);
    else parameter.setTargetAtTime(target, now, tau);
  }

  applySettings() {
    if (!this.channels) return;
    for (const [key, channel] of Object.entries(this.channels)) this.param(channel.gain, key === 'master' && this.muted ? 0 : this.settings[key], .025);
  }

  setting(key, value, { persist = true } = {}) {
    if (!(key in audioDefaults)) return;
    this.settings[key] = key === 'subtitles' ? Boolean(value) : bounded(value, audioDefaults[key]);
    this.applySettings();
    this.showCaption();
    if (persist) {
      try { this.persistSettings(); } catch { /* Session-only settings. */ }
    }
  }

  setMuted(value) { this.muted = Boolean(value); this.applySettings(); }

  persistSettings() { this.storage?.setItem(storageKey, JSON.stringify(this.settings)); }

  source(buffer, target, level, loop = false) {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.value = level;
    source.connect(gain);
    const targets = Array.isArray(target) ? target : [target];
    for (const node of targets) gain.connect(node);
    const handle = { source, gain };
    source.onended = () => {
      this.effects.delete(handle);
      source.disconnect();
      gain.disconnect();
    };
    return handle;
  }

  stop(handle) {
    if (!handle) return;
    handle.source.onended = null;
    handle.source.stop();
    handle.source.disconnect();
    handle.gain.disconnect();
    this.effects.delete(handle);
  }

  fx(id, route = 'vehicle', level = 1, delay = 0) {
    if (this.context?.state !== 'running' || !this.soundBank[id]) return;
    const buffer = this.soundBank[id];
    if (-delay >= buffer.duration) return;
    const target = route === 'ui' ? this.channels.interface : route === 'radio' ? this.radio
      : route === 'alert' ? this.channels.effects : route === 'cabin' ? this.interiorStructure
        : [this.exteriorAir, this.interiorStructure];
    const handle = this.source(buffer, target, level);
    if (route !== 'ui') this.effects.add(handle);
    handle.source.start(this.context.currentTime + Math.max(delay, 0), Math.max(-delay, 0));
  }

  loop(id, sound, route, gain) {
    let handle = this.loops.get(id);
    if (!handle && gain > .001 && this.context.state === 'running') {
      handle = this.source(this.soundBank[sound], route, 0, true);
      this.loops.set(id, handle);
      handle.source.start();
    }
    this.param(handle?.gain.gain, gain, .07);
  }

  mix(frame) {
    this.mixState = frame;
    this.refreshMix();
  }

  refreshMix() {
    if (!this.context) return;
    const { density, pressure, distance, pan, cabin, engine } = this.mixState;
    const atmosphere = Math.min(1, Math.max(0, density / 1.225) ** .30);
    const attenuation = 1 / (1 + Math.max(0, distance) / 115) ** .93;
    this.param(this.outside.gain, cabin ? 0 : atmosphere * attenuation, cabin || !atmosphere ? 0 : .045);
    this.param(this.inside.gain, cabin ? 1 : 0, cabin ? .035 : 0);
    this.param(this.exteriorAir.frequency, 600 + 5600 * attenuation * atmosphere);
    this.param(this.panner?.pan, pan);
    const running = this.running && !this.paused;
    const power = running ? Math.max(0, engine) : 0;
    const loads = running ? bounded(pressure / 36, 0) : 0;
    this.loop('engine', 'engine', this.exteriorAir, cabin || !atmosphere ? 0 : .95 * power);
    this.loop('thrustInside', 'engine', this.interiorStructure, cabin ? .46 * power : 0);
    this.loop('air', 'airflow', this.exteriorAir, cabin || !atmosphere ? 0 : .59 * loads);
    this.loop('structure', 'airflow', this.interiorStructure, cabin ? .26 * loads : 0);
    this.loop('equipment', 'cabin', this.interiorStructure, running && cabin ? .32 : 0);
    this.loop('music', 'music', this.musicBed, running ? .72 : 0);
  }

  begin() {
    this.reset();
    this.running = true;
  }

  reset() {
    this.running = false;
    this.paused = false;
    this.launchPlanned = false;
    this.queue.length = 0;
    this.cancelVoice();
    for (const handle of this.effects) this.stop(handle);
    for (const handle of this.loops.values()) this.stop(handle);
    this.loops.clear();
    this.refreshMix();
  }

  end() {
    this.running = false;
    for (const handle of this.loops.values()) this.stop(handle);
    this.loops.clear();
  }

  cancelVoice() {
    this.stop(this.active?.handle);
    this.active = null;
    this.showCaption();
    this.duck(false);
  }

  duck(talking) {
    this.param(this.musicBed?.gain, talking ? .26 : 1, talking ? .065 : .24);
  }

  showCaption() {
    let item = this.settings.subtitles && !this.paused ? this.active : null;
    if (item?.cues) {
      const elapsed = item.offset + this.now() - item.started;
      item = item.cues.find(cue => elapsed >= cue.at && elapsed < cue.at + cue.duration);
    }
    if (this.captionId === item?.id) return;
    this.captionId = item?.id;
    this.subtitle(item ? { id: item.id, speaker: speakers[item.line.speaker].name, text: item.line.en } : null);
  }

  pause(value) {
    if (value === this.paused) return;
    const now = this.now();
    this.paused = value;
    if (value) {
      this.pausedAt = now;
      if (this.active) {
        this.active.offset = Math.min(this.active.duration, this.active.offset + now - this.active.started);
        this.stop(this.active.handle);
        this.active.handle = null;
      }
      for (const handle of this.effects) this.stop(handle);
    } else {
      for (const item of this.queue) item.expires += now - this.pausedAt;
      if (this.active) this.play(this.active, false);
    }
    this.showCaption();
    this.refreshMix();
  }

  link(available) {
    if (available) {
      this.queue = this.queue.filter(item => item.id !== 'link_lost');
      return;
    }
    this.queue = this.queue.filter(item => item.line.speaker === 'computer');
    if (this.active && this.active.line.speaker !== 'computer') this.cancelVoice();
  }

  speak(ids, { replace = false, deadline } = {}) {
    if (replace) {
      this.queue.length = 0;
      this.cancelVoice();
    }
    const now = this.now();
    for (const id of ids) {
      if (this.active?.id === id || this.queue.some(item => item.id === id)) continue;
      const line = radioLines[id];
      this.queue.push({ id, line, order: ++this.order, expires: now + (deadline ?? (line.priority >= 75 ? 12 : 7)) });
    }
    this.queue.sort((a, b) => b.line.priority - a.line.priority || a.order - b.order);
    const head = this.queue[0];
    if (this.active && head?.line.priority >= 78 && head.line.priority > this.active.line.priority) this.cancelVoice();
    this.tick();
  }

  play(item, fresh) {
    const { id, line } = item;
    const buffer = item.buffer ?? this.voices.get(id);
    const short = id.startsWith('count_');
    const rate = short && buffer ? Math.max(1, buffer.duration / .90) : 1;
    if (fresh) {
      item.offset = 0;
      item.duration ??= buffer ? buffer.duration / rate : short ? .88 : Math.max(1.1, line.en.length / 19);
    }
    item.started = this.now();
    this.active = item;
    if (buffer && this.context.state === 'running' && item.offset < item.duration) {
      const handle = this.source(buffer, this.radio, .98);
      handle.source.playbackRate.value = rate;
      handle.source.start(0, item.offset * rate);
      item.handle = handle;
    }
    if (item.timedEffects) {
      for (const [sound, at, level, route = 'vehicle'] of item.timedEffects) this.fx(sound, route, level, at - item.offset);
    }
    if (fresh && !short && !item.cues && id !== 'ignition' && id !== 'liftoff') this.fx('radio', 'radio', .28);
    this.showCaption();
    this.duck(true);
  }

  tick() {
    if (this.paused) return;
    const now = this.now();
    if (this.active && this.active.offset + now - this.active.started >= this.active.duration) {
      this.cancelVoice();
    }
    if (this.active) {
      if (this.active.cues) this.showCaption();
      return;
    }
    while (this.queue.length) {
      const item = this.queue.shift();
      if (item.expires >= now) {
        this.play(item, true);
        break;
      }
    }
  }

  launchTimeline(state, options, preflight, prepSeconds) {
    const cues = [];
    const countAt = state.preflight;
    const liftoffAt = countAt + state.countdown;
    const add = (id, at, limit) => {
      const line = radioLines[id];
      const buffer = this.voices.get(id);
      const duration = Math.min(limit, buffer?.duration ?? Math.max(.72, line.en.length / 19));
      cues.push({ id, line, at, buffer, duration });
      return duration;
    };
    let at = 0;
    for (const id of preflight) {
      if (at >= countAt) break;
      at += add(id, at, countAt - at) + .04;
    }
    for (let value = 10; value > 0; value--) {
      const [id] = radioFor({ type: 'count', detail: { value } }, options);
      if (id) add(id, countAt + 10 - value, .92);
    }
    const [ignition, liftoff] = radioFor({ type: 'liftoff', detail: {} }, options);
    at = liftoffAt + (ignition ? add(ignition, liftoffAt, 1.0) + .035 : 0);
    const duration = at + (liftoff ? add(liftoff, at, 1.0) : .7);

    // Bake the voice transmission so a slow render frame cannot delay a word.
    let buffer;
    if (this.context && cues.some(cue => cue.buffer)) {
      const rate = this.context.sampleRate;
      buffer = this.context.createBuffer(1, Math.ceil(duration * rate), rate);
      const pcm = buffer.getChannelData(0);
      for (const cue of cues) {
        if (!cue.buffer) continue;
        const samples = cue.buffer.getChannelData(0);
        const offset = Math.round(cue.at * rate);
        const count = Math.min(samples.length, pcm.length - offset, Math.round(cue.duration * rate));
        const fade = .016 * rate;
        for (let i = 0; i < count; i++) pcm[offset + i] = samples[i] * Math.min(1, i / fade, (count - i - 1) / fade);
      }
    }
    this.launchPlanned = true;
    this.play({
      id: 'launch_timeline', line: radioLines.ignition, duration, cues, buffer,
      timedEffects: [
        ['mechanism', 0, .48], ['radio', 0, .25, 'radio'], ['spin', liftoffAt - prepSeconds, 1],
        ['ignition', liftoffAt, .42], ['launch', liftoffAt, 1],
      ],
    }, true);
  }

  mission(event, state) {
    const { type, detail } = event;
    const options = { id: state.id, crew: state.crew, link: state.systems.link };
    if (type === 'preflight') {
      this.launchTimeline(state, options, radioFor(event, options), detail.prepSeconds);
      return;
    }
    if (this.launchPlanned && ['enginePrep', 'count', 'liftoff'].includes(type)) return;
    if (type === 'link') this.link(detail.available);
    if (type === 'failure' || type === 'launchAbort') this.reset();
    if (type === 'success') {
      this.end();
      this.queue = this.queue.filter(item => item.line.priority >= 54);
      if (this.active?.line.priority < 54) this.cancelVoice();
    }
    const effect = {
      preflight: 'mechanism', enginePrep: 'spin', liftoff: 'launch', stage: 'stage', stageIgnition: 'ignition',
      dock: 'docking', undock: 'mechanism', parachutes: 'mechanism',
      moonTouch: 'touchdown', marsTouch: 'touchdown', splash: 'splash', probeImpact: 'impact',
      failure: detail.reason === 'structure' ? 'blast' : 'impact',
    }[type];
    if (effect) this.fx(effect, 'vehicle', type === 'preflight' ? .48 : 1);
    if (type === 'liftoff') this.fx('ignition', 'vehicle', .42);
    if (type === 'failure') this.fx('fracture', 'vehicle', .64);
    if (type === 'warning' || type === 'failure' || type === 'link' && !detail.available) this.fx('alert', 'alert', .48);
    const ids = radioFor(event, options);
    const hard = ['count', 'liftoff', 'failure', 'launchAbort'].includes(type);
    this.speak(ids, { replace: hard, deadline: type === 'count' ? 1 : undefined });
  }
}
