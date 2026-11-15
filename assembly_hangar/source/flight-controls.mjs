import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { assistanceLevels, controlProfiles, ownerActions, profileBindings } from './control-profiles.mjs';

export const controlsKey = 'jugre.controls.v1';
const uiActions = ['pause', 'takeover', 'nextActor'];
const phaseProfiles = {
  ascent: 'rocket', moonLanding: 'lander', marsLanding: 'lander',
  moonSurface: 'astronaut', marsSurface: 'rover',
};

export function controlContext(state, presentation = false) {
  const onSurface = ['moonSurface', 'marsSurface'].includes(state.kind);
  const ascentLocal = state.kind === 'rendezvous' && state.localAscent && state.localAscent.status !== 'orbit';
  const profile = ascentLocal ? 'lander' : onSurface && state.surfaceExpedition ? state.surfaceExpedition.current.profile : phaseProfiles[state.kind] ?? 'spacecraft';
  const passiveOrbit = state.kind === 'orbit' || state.interplanetary?.departed
    || (state.kind !== 'separate' && state.path?.physical && !state.path.isPowered(state.time));
  let owner = null;
  let reason = '';
  if (state.complete || state.failed || state.aborted) reason = 'Flight ended.';
  else if (state.preflight > 0 || state.countdown > 0 || state.holding) reason = 'Controls unlock after countdown and HOLD.';
  else if (presentation && !state.assemblyActive) reason = 'Automatic maneuver in progress.';
  else if (state.assemblyActive) owner = 'assembly';
  else if (ascentLocal) owner = 'lunarAscent';
  else if (state.localAscent?.status === 'orbit' && state.kind === 'rendezvous') owner = state.localPhysicsAvailable ? 'physx' : 'trajectory';
  else if (onSurface) owner = 'surface';
  else if (state.marsEdl && state.kind === 'marsLanding') owner = 'surface';
  else if (state.historicalOperations?.manualMotor && state.path?.physical && state.path.isPowered(state.time)) owner = 'trajectory';
  else if (['moonLanding', 'marsLanding'].includes(state.kind) && (state.localLanding || state.altitude <= .5) && !state.design?.spec?.lunar) owner = 'surface';
  else if (state.localPhysicsAvailable && (passiveOrbit || state.dockingPhysicsReady)) owner = 'physx';
  else if (state.kind === 'ascent') owner = 'launch';
  else if (passiveOrbit) owner = 'trajectory';
  else if (state.path?.physical || state.lunar?.entry) reason = 'Autopilot controls this maneuver.';
  else reason = 'Guided segment';
  const columbia = state.objectivesEnabled && state.kind === 'rendezvous' && state.dockingPhysicsReady;
  const actorId = onSurface && state.surfaceExpedition ? state.surfaceExpedition.current.id : columbia ? 'columbia' : 'vessel';
  return { profile, actorId, phaseIndex: state.phaseIndex, owner, reason };
}

export function inputBlockReason(state, context, rate) {
  if (rate > 1) return 'Set time warp to ×1 for manual control.';
  if (state.paused) return 'Flight paused.';
  return context.reason;
}

// Route by owner and phase at the simulation step, even if the view sampled
// its keyboard/gamepad frame just before a phase transition.
export function routeFlightInput(state, frame, rate, handlers) {
  const context = controlContext(state, frame?.presentation);
  if (!frame || state.mode !== 'manual' || !context.owner || inputBlockReason(state, context, rate)) return false;
  if (frame.owner !== context.owner || frame.profile !== context.profile
    || frame.actorId !== context.actorId || frame.phaseIndex !== context.phaseIndex) return false;
  const handler = handlers[context.owner];
  if (!handler) return false;
  handler(frame);
  return true;
}

export function restoreManualControl(saved) {
  const control = { assistance: 'standard', sas: false, rcs: true, precision: false,
    attitude: null, angularRate: new Vector3() };
  if (saved?.version !== 1) return control;
  if (Object.hasOwn(assistanceLevels, saved.assistance)) control.assistance = saved.assistance;
  for (const name of ['sas', 'rcs', 'precision']) if (typeof saved[name] === 'boolean') control[name] = saved[name];
  const finite = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
  if (finite(saved.attitude, 4) && Math.abs(Math.hypot(...saved.attitude) - 1) < .01) {
    control.attitude = new Quaternion().fromArray(saved.attitude);
  }
  if (finite(saved.angularRate, 3) && saved.angularRate.every(n => Math.abs(n) <= Math.PI)) {
    control.angularRate.fromArray(saved.angularRate);
  }
  return control;
}

export function serializeManualControl(state) {
  const { profile, actorId } = controlContext(state);
  const { assistance, sas, rcs, precision, attitude, angularRate } = state.manualControl;
  return { version: 1, profile, actorId, assistance, sas, rcs, precision, attitude: attitude?.toArray() ?? null,
    angularRate: angularRate.toArray() };
}

export function updateControlSwitches(control, actions) {
  if (actions.has('sas') && !assistanceLevels[control.assistance].sasForced) control.sas = !control.sas;
  if (actions.has('rcs')) control.rcs = !control.rcs;
  if (actions.has('precision')) control.precision = !control.precision;
}

const rotationStep = new Quaternion();
const angles = new Euler();
const targetRate = new Vector3();
export function stepOrbitalAttitude(control, axes, dt, forwardZ = false) {
  if (!control.attitude) return;
  const sas = control.sas || assistanceLevels[control.assistance].sasForced;
  const maxRate = MathUtils.degToRad(controlProfiles.spacecraft.limits.angularRateDegS) * (control.precision ? .25 : 1);
  const { pitch = 0, yaw = 0, roll = 0 } = axes;
  targetRate.set(-pitch, forwardZ ? yaw : roll, forwardZ ? roll : -yaw).multiplyScalar(maxRate);
  const { angularRate } = control;
  if (control.rcs) {
    // With SAS off, releasing the controls leaves the current spin.
    for (const axis of ['x', 'y', 'z']) {
      if (sas || targetRate[axis]) angularRate[axis] = MathUtils.damp(angularRate[axis], targetRate[axis], 8, dt);
    }
  }
  rotationStep.setFromEuler(angles.set(angularRate.x * dt, angularRate.y * dt, angularRate.z * dt));
  control.attitude.multiply(rotationStep).normalize();
}

const validKey = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|ShiftLeft|ShiftRight|ControlLeft|ControlRight|Space|CapsLock|Equal|Minus|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Backslash|Backquote)$/;

export function keyLabel(code) {
  return ({ Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl',
    ControlRight: 'Right Ctrl', CapsLock: 'Caps Lock', Equal: '=', Minus: '-', ArrowUp: '↑',
    ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' })[code] ?? code.replace(/^(Key|Digit)/, '');
}

export class ControlBindings {
  constructor(storage) {
    this.storage = storage;
    this.overrides = {};
    try {
      const saved = JSON.parse(storage.getItem(controlsKey));
      if (saved?.version === 1) for (const profile of Object.keys(controlProfiles)) {
        const candidate = saved.profiles?.[profile];
        if (!candidate || typeof candidate !== 'object') continue;
        const bindings = profileBindings(profile);
        const entries = Object.entries(candidate).filter(([action, key]) =>
          Object.hasOwn(bindings, action) && typeof key === 'string' && validKey.test(key));
        const overrides = Object.fromEntries(entries);
        const all = Object.entries(bindings).flatMap(([action, binding]) => [overrides[action] ?? binding.key, ...binding.aliases]);
        if (all.length === new Set(all).size) this.overrides[profile] = overrides;
      }
    } catch { /* Storage may be unavailable on file:// or in private mode. */ }
  }

  key(profile, action) { return this.overrides[profile]?.[action] ?? profileBindings(profile)[action].key; }

  remap(profile, action, key) {
    const bindings = profileBindings(profile);
    if (key === 'Tab') return 'Tab opens the flight log.';
    if (!Object.hasOwn(bindings, action) || !validKey.test(key)) return 'Choose a key without system modifiers.';
    for (const [other, binding] of Object.entries(bindings)) {
      if (binding.aliases.includes(key) || other !== action && this.key(profile, other) === key) {
        return `Key already assigned · ${binding.label}.`;
      }
    }
    const changes = this.overrides[profile] ??= {};
    if (key === bindings[action].key) delete changes[action];
    else changes[action] = key;
    return this.persist();
  }

  reset(profile) {
    delete this.overrides[profile];
    return this.persist();
  }

  persist() {
    try { this.storage.setItem(controlsKey, JSON.stringify({ version: 1, profiles: this.overrides })); }
    catch { return 'Keys saved for this session.'; }
    return '';
  }
}

const gamepadActions = { 0: 'stage', 1: 'cutoff', 3: 'fullThrottle', 8: 'takeover', 9: 'pause', 10: 'precision' };
const deadzone = (value = 0) => Math.sign(value) * MathUtils.clamp((Math.abs(value) - .18) / .82, 0, 1);

export function connectedGamepad(navigator) {
  try {
    return Array.from(navigator.getGamepads?.() ?? []).find(pad => pad?.connected && pad.mapping === 'standard');
  } catch { return undefined; }
}

export class FlightInput {
  constructor(bindings) {
    this.bindings = bindings;
    this.keys = new Set();
    this.edges = new Set();
    this.pointers = new Map();
    this.buttons = new Set();
    this.padReady = false;
  }

  clear() {
    this.keys.clear();
    this.edges.clear();
    this.pointers.clear();
    this.buttons.clear();
    this.padReady = false;
  }

  keyDown(code, repeat) {
    if (repeat || this.keys.has(code)) return;
    this.keys.add(code);
    this.edges.add(code);
  }

  actionsFor(context) { return [...uiActions, ...(ownerActions[context.owner] ?? [])].filter(action => Object.hasOwn(profileBindings(context.profile), action)); }

  matchKey(context, code) {
    const bindings = profileBindings(context.profile);
    return this.actionsFor(context).find(action =>
      this.bindings.key(context.profile, action) === code || bindings[action].aliases.includes(code));
  }

  sample(context, gamepad) {
    const bindings = profileBindings(context.profile);
    const actions = new Set();
    const held = new Set(this.pointers.values());
    const available = this.actionsFor(context);
    for (const action of available) {
      const codes = [this.bindings.key(context.profile, action), ...bindings[action].aliases];
      if (codes.some(code => this.keys.has(code))) held.add(action);
      if (codes.some(code => this.edges.has(code))) actions.add(action);
    }
    this.edges.clear();
    if (held.has('brake')) actions.add('brake');
    const axes = {};
    for (const [axis, [positive, negative]] of Object.entries(controlProfiles[context.profile].axes)) {
      if (available.includes(positive)) axes[axis] = Number(held.has(positive)) - Number(held.has(negative));
    }
    if (gamepad?.mapping === 'standard') {
      const pressed = new Set(gamepad.buttons.flatMap((button, i) => button.pressed ? [i] : []));
      const analog = { pitch: -deadzone(gamepad.axes[1]), roll: deadzone(gamepad.axes[0]), yaw: deadzone(gamepad.axes[2]),
        throttle: deadzone(gamepad.buttons[7]?.value) - deadzone(gamepad.buttons[6]?.value),
        longitudinal: -deadzone(gamepad.axes[1]), lateral: deadzone(gamepad.axes[0]), drive: -deadzone(gamepad.axes[1]), steer: deadzone(gamepad.axes[0]),
        climb: deadzone(gamepad.buttons[7]?.value) - deadzone(gamepad.buttons[6]?.value) };
      if (!pressed.size && !Object.values(analog).some(Boolean)) this.padReady = true;
      if (this.padReady) {
        for (const [i, action] of Object.entries(gamepadActions)) {
          if (pressed.has(Number(i)) && !this.buttons.has(Number(i)) && available.includes(action)) actions.add(action);
        }
        for (const axis of Object.keys(axes)) axes[axis] ||= analog[axis] ?? 0;
      }
      this.buttons = pressed;
    } else {
      this.buttons.clear();
      this.padReady = false;
    }
    return { ...context, axes, actions };
  }
}
