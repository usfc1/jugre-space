const bind = (label, key, ...aliases) => ({ label, key, aliases });
const rotation = {
  pitchUp: bind('Pitch +', 'KeyW', 'ArrowUp'),
  pitchDown: bind('Pitch −', 'KeyS', 'ArrowDown'),
  rollLeft: bind('Roll left', 'KeyA', 'ArrowLeft'),
  rollRight: bind('Roll right', 'KeyD', 'ArrowRight'),
  yawLeft: bind('Yaw left', 'KeyQ'),
  yawRight: bind('Yaw right', 'KeyE'),
};
const rotations = { pitch: ['pitchUp', 'pitchDown'], roll: ['rollRight', 'rollLeft'], yaw: ['yawRight', 'yawLeft'] };
const throttle = { throttleUp: bind('Throttle up', 'ShiftLeft'), throttleDown: bind('Throttle down', 'ControlLeft') };
const tools = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`tool${i + 1}`, bind(`Tool ${i + 1}`, `Digit${i + 1}`)]));
const common = {
  pause: bind('Pause', 'KeyP'),
  takeover: bind('Switch control mode', 'KeyU'),
  nextActor: bind('Next vehicle', 'KeyV'),
  sas: bind('Stabilization', 'KeyT'),
  rcs: bind('RCS', 'KeyR'),
  precision: bind('Precision mode', 'CapsLock'),
};
const widgets = ['navball', 'throttle', 'resource', 'objective'];
const profile = (label, bindings, axes, limits) => ({ label, bindings, axes, limits, widgets });

export const controlProfiles = {
  rocket: profile('Rocket', {
    ...rotation, ...throttle, fullThrottle: bind('Full throttle', 'KeyZ'),
    cutoff: bind('Cutoff', 'KeyX'), stage: bind('Separate stage', 'Space'),
  }, { ...rotations, throttle: ['throttleUp', 'throttleDown'] }, { throttlePerSecond: .3, manualRate: 1 }),
  spacecraft: profile('Spacecraft', {
    ...rotation, up: bind('Up', 'KeyI'), down: bind('Down', 'KeyK'),
    left: bind('Left', 'KeyJ'), right: bind('Right', 'KeyL'),
    forward: bind('Forward', 'KeyH'), backward: bind('Back', 'KeyN'),
  }, { ...rotations, vertical: ['up', 'down'], lateral: ['right', 'left'], longitudinal: ['forward', 'backward'] },
  { angularRateDegS: 15, manualRate: 1, docking: { speedMps: .2, lateralM: .2, angleDeg: 4, angularRateDegS: .2 } }),
  lander: profile('Lander', {
    ...rotation, ...throttle, descentUp: bind('Increase descent rate', 'Equal'), descentDown: bind('Reduce descent rate', 'Minus'),
  }, { ...rotations, throttle: ['throttleUp', 'throttleDown'] },
  { descentStepMps: .3, verticalMps: 3, horizontalMps: 1.2, tiltDeg: 12 }),
  rover: profile('Rover', {
    interact: bind('Use tool', 'KeyF'), drop: bind('Drop sample tube', 'KeyG'),
    forward: bind('Throttle', 'KeyW'), backward: bind('Reverse', 'KeyS'),
    left: bind('Steer left', 'KeyA'), right: bind('Steer right', 'KeyD'),
    turnLeft: bind('Turn left', 'KeyQ'), turnRight: bind('Turn right', 'KeyE'),
    brake: bind('Brake', 'Space'), ...tools,
  }, { drive: ['forward', 'backward'], steer: ['right', 'left'], spin: ['turnRight', 'turnLeft'] },
  { resources: ['energy', 'wheelWear'], constraints: ['speed', 'tilt', 'slip'] }),
  helicopter: profile('Helicopter', {
    ...throttle, forward: bind('Forward', 'KeyW'), backward: bind('Back', 'KeyS'),
    left: bind('Left', 'KeyA'), right: bind('Right', 'KeyD'),
    yawLeft: rotation.yawLeft, yawRight: rotation.yawRight, hoverLand: bind('Hover / land', 'Space'),
  }, { climb: ['throttleUp', 'throttleDown'], longitudinal: ['forward', 'backward'], lateral: ['right', 'left'], yaw: rotations.yaw },
  { resources: ['battery'], constraints: ['temperature', 'link', 'dust', 'navigation'] }),
  astronaut: profile('Astronaut', {
    forward: bind('Forward', 'KeyW'), backward: bind('Back', 'KeyS'),
    left: bind('Left', 'KeyA'), right: bind('Right', 'KeyD'),
    jump: bind('Hop', 'Space'), interact: bind('Interact', 'KeyF'), drop: bind('Drop item', 'KeyG'), ...tools,
  }, { longitudinal: ['forward', 'backward'], lateral: ['right', 'left'] }, { resources: ['backpackTime'] }),
};

export const assistanceLevels = {
  arcade: { label: 'Arcade', sasForced: true, prediction: true, landingPrediction: true, toleranceScale: 1.3,
    marsCommandDelay: false, autonomousHelicopter: false },
  standard: { label: 'Standard', sasForced: false, prediction: false, landingPrediction: true, toleranceScale: 1,
    marsCommandDelay: false, autonomousHelicopter: false },
  realism: { label: 'Realism', sasForced: false, prediction: false, landingPrediction: false, toleranceScale: .75,
    marsCommandDelay: true, autonomousHelicopter: true },
};

const bindingsByProfile = Object.fromEntries(Object.entries(controlProfiles).map(([id, profile]) =>
  [id, { ...common, ...profile.bindings }]));

export function profileBindings(id) { return bindingsByProfile[id]; }

// Which commands the current motion solver can accept. The profile's full
// bindings also describe commands for later controllers.
export const ownerActions = {
  lunarAscent: Object.keys(rotation),
  assembly: Object.keys(controlProfiles.spacecraft.bindings).concat('sas', 'rcs', 'precision'),
  surface: [...new Set(['lander', 'astronaut', 'rover', 'helicopter'].flatMap(id => Object.keys(controlProfiles[id].bindings)))].concat('sas', 'precision'),
  physx: Object.keys(controlProfiles.spacecraft.bindings).concat('sas', 'rcs', 'precision'),
  launch: ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight',
    'throttleUp', 'throttleDown', 'fullThrottle', 'cutoff', 'stage', 'sas', 'precision'],
  trajectory: ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight', 'sas', 'rcs', 'precision'],
};
