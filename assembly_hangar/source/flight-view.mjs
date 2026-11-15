import {
  Box3, BufferGeometry, DirectionalLight, Euler, Float32BufferAttribute, Group, HemisphereLight,
  LineBasicMaterial, LineSegments, Matrix4, Quaternion, Scene, Vector3, MathUtils,
} from 'three';
import { ASTEROID, EARTH_RADIUS, FlightState, FLORIDA, MARS, MOON, PREIGNITION_SECONDS, east, launchUp } from './flight-missions.mjs';
import { airDensity } from './flight-systems.mjs';
import { createSpaceWorld, frameRotation } from './space-world.mjs';
import { makeAscentSmoke, makeExhaust } from './flight-effects.mjs';
import { makeLandingGround } from './landing-ground.mjs';
import { alignDockingPorts, dockingPort, findPart, positionColumbia } from './flight-layout.mjs';
import { createRecoveryView } from './recovery-view.mjs';
import { reentryProfile } from './reentry-profile.mjs';
import { PAD_POSITION_M, padLocalPosition, surfaceToInertialVelocity } from './flight-coordinates.mjs';
import { createAscentView } from './ascent-view.mjs';
import { createCabinInteriors } from './cabin-interior.mjs';
import { apolloTransposition, captureAssemblyStage, captureParts, createDepartures, deploymentPose, fairingParts, finishSkippedManeuver, orbitalPayloads, relativeBounds } from './flight-maneuvers.mjs';
import { createDartEncounter } from './dart-encounter.mjs';
import { deployDartArrays, releaseLiciacube } from './dart-deployment.mjs';
import { isDartEncounter } from './dart-course.mjs';
import { TimelineRenderer } from './timeline-renderer.mjs';
import { FlightDiagnostics } from './flight-diagnostics.mjs';
import { loadPhysX, fromPx } from './physx-runtime.mjs';
import { FlightRigidPhysics } from './flight-rigid.mjs';
import { LUNAR_TIMING } from './lunar-trajectory.mjs';
import { bodyNames } from './mission-planets.mjs';
import { apolloExtractionDuration, displayedSpaceScale, shortenedSpaceScale } from './short-flight.mjs';
import { assistanceLevels } from './control-profiles.mjs';
import { ControlBindings, FlightInput, connectedGamepad, controlContext, inputBlockReason } from './flight-controls.mjs';
import { setupManualControlView } from './manual-control-view.mjs';
import { setupRocketControls } from './rocket-control-view.mjs';
import { setupLocalControls } from './local-control-view.mjs';
import { setupHistoricalObjectives } from './historical-objective-view.mjs';
import { AssemblyRcs } from './assembly-rcs.mjs';
import { FlightJournal } from './flight-journal.mjs';

const format = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const PAD_HANDOFF_KM = 0.65;
const PAD_FADE_END_KM = 3.2;
const landerKinds = new Set(['moonLanding', 'moonSurface', 'rendezvous']);
const moonKinds = new Set(['moonOrbit', 'lunarFlyby', 'separate', ...landerKinds]);
const phaseLocation = {
  ascent: 'LC-39A', orbit: 'Earth / orbit', moonTransfer: 'Earth → Moon',
  moonOrbit: 'Moon / orbit', lunarFlyby: 'Moon / flyby', separate: 'Moon / orbit',
  moonLanding: 'Moon / Sea of Tranquility', moonSurface: 'Moon / Sea of Tranquility', rendezvous: 'Moon / ascent',
  marsLanding: 'Mars / landing site', marsSurface: 'Mars / surface',
  jupiterFlyby: 'Jupiter / flyby', saturnFlyby: 'Saturn / flyby',
  stationApproach: 'Earth / ISS', docking: 'Earth / ISS',
  dartRelease: 'Didymos / observer separation', dartApproach: 'Dimorphos / final approach',
  dartAftermath: 'Dimorphos / impact observation',
  reentry: 'Atlantic / splashdown',
};
const upAxis = new Vector3(0, 1, 0);
const upsideDown = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
const flightScene = new Scene();
flightScene.background = null;
const ambient = new HemisphereLight(0x829dc5, 0x161920, 0.7);
const sun = new DirectionalLight(0xffefd8, 2.6);
sun.position.set(-45, 70, 45);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 200 });
sun.shadow.normalBias = 0.025;
flightScene.add(ambient, sun);

export function setupFlightView({ launch, camera, controls, loader, decode, audio, suits, textures, onStart, onStop, onDesignTelemetry, payloadForFlight, getCustomLayout }) {
  const panel = document.querySelector('#flight-panel');
  const start = document.querySelector('#flight-start');
  const roverTrial = document.querySelector('#launch-rover');
  roverTrial.innerHTML = '<span>Rover test range</span><select aria-label="Rover model"><option value="barkhan_4">Barkhan-4</option><option value="barkhan_6">Barkhan-6</option></select><button class="control" type="button">Drive rover</button>';
  roverTrial.querySelector('button').onclick = () => begin(null, roverTrial.querySelector('select').value);
  const warp = document.querySelector('#flight-warp');
  const launchFlightLength = document.querySelector('#launch-flight-length');
  const throttle = document.querySelector('#flight-throttle');
  const map = document.querySelector('#flight-map');
  const mapContext = map.getContext('2d');
  const mapToggle = document.querySelector('#flight-map-toggle');
  const eventText = document.querySelector('#flight-event');
  const banner = document.querySelector('#flight-banner');
  const status = document.querySelector('#flight-status');
  const stopButton = document.querySelector('#flight-stop');
  const cockpit = document.querySelector('#cockpit-hud');
  const dartReplay = document.querySelector('#flight-dart-replay');
  const cameraButtons = [...document.querySelectorAll('[data-flight-camera]')];
  const holdButton = document.querySelector('#flight-hold');
  const skipManeuverButton = document.querySelector('#flight-skip-maneuver');
  const sceneTools = document.querySelector('#flight-scene-tools');
  const cameraMenu = document.querySelector('#flight-camera-menu');
  const journalDialog = document.querySelector('#flight-journal');
  const timeline = new TimelineRenderer(document.querySelector('#broadcast-hud'), {
    live: document.querySelector('#timeline-live'),
  });
  let storage;
  try { storage = window.localStorage; } catch { /* Optional browser storage. */ }
  const bindings = new ControlBindings(storage);
  let defaultAssistance = 'standard';
  let defaultTracking = true;
  const flightInput = new FlightInput(bindings);
  let throttleTarget;
  let stageRequested = false;
  const clearInput = () => {
    flightInput.clear();
    throttleTarget = undefined;
    stageRequested = false;
  };
  const journal = new FlightJournal(journalDialog, clearInput);
  const manualView = setupManualControlView(panel, {
    toggle: toggleControl,
    setAssistance: value => {
      if (state && Object.hasOwn(assistanceLevels, value)) state.manualControl.assistance = value;
      clearInput();
      telemetry();
    },
  });
  const rocketView = setupRocketControls(panel, () => state, () => {
    if (!state.rocketTest || state.kind !== 'ascent' || state.paused) return;
    const orbit = state.launch.orbit, target = state.execution?.plan.target;
    const peri = target?.periapsisM ?? state.launch.vehicle.guidance.targetAltitudeM;
    const apo = target?.apoapsisM ?? peri, tolerance = target?.toleranceM ?? 10000;
    if (orbit.energy >= 0 || Math.abs(orbit.periapsisM - peri) > tolerance || Math.abs(orbit.apoapsisM - apo) > tolerance) return;
    state.throttle = 0;
    state.launch.cutoff = true;
    state.launch.thrustN = 0;
    state.rocketTest = false;
    state.advancePhase();
    phaseChanged();
  });
  const localView = setupLocalControls(panel, () => state, () => telemetry());
  let stageCheckpoint;
  const objectiveView = setupHistoricalObjectives(panel, () => state, () => { if (stageCheckpoint) restoreCheckpoint(structuredClone(stageCheckpoint)); });
  const stationButtons = document.createElement('div');
  stationButtons.innerHTML = '<button type="button">Request clearance</button><button type="button">Retreat</button><output></output>';
  panel.append(stationButtons);
  const [stationClearance, stationRetreat] = stationButtons.querySelectorAll('button');
  const stationControl = () => state?.objectivesEnabled && !state.paused && !state.failed && state.mode === 'manual' && requestedFlightRate() <= 1;
  stationClearance.onclick = () => { if (stationControl()) rigid?.grantStationClearance(); };
  stationRetreat.onclick = () => { if (stationControl()) rigid?.retreatFromStation(); };
  const cubeControls = document.createElement('div');
  cubeControls.innerHTML = '<label>LICIACube camera <select><option value="0">Impact site</option><option value="1">Ejecta cloud</option><option value="2">Plume</option><option value="3">Far side</option></select></label><label>Sight offset, ° <input type="number" step="1" value="0"></label><button type="button">Capture frame</button><output></output>';
  panel.append(cubeControls);
  function takeCubeFrame(index, aim) {
    const nav = state.historicalOperations.dart;
    const frame = dartEncounter.cubeFrame(state, index, aim);
    if (!frame || nav.cubeFrames.some(old => old.cameraIndex === index)) return false;
    nav.cubeFrames.push(frame);
    state.report('cubeFrame', { ...frame, frames: nav.cubeFrames.length }, 'cubeFrame:' + index); return true;
  }
  cubeControls.querySelector('button').onclick = () => {
    if (!state.objectivesEnabled || state.kind !== 'dartAftermath' || state.paused || state.complete) return;
    takeCubeFrame(Number(cubeControls.querySelector('select').value), Number(cubeControls.querySelector('input').value));
  };
  const ship = new Group();
  const nearby = new Group();
  const surfaceHardware = new Group();
  flightScene.add(ship, nearby, surfaceHardware);
  let rigid;
  let dragonRetreat;
  let assemblyRcs;
  function endAssembly() {
    if (!assemblyRcs) return;
    const v = fromPx(assemblyRcs.host.actor.getLinearVelocity()).applyQuaternion(flightFrame);
    const w = fromPx(assemblyRcs.host.actor.getAngularVelocity()).applyQuaternion(flightFrame);
    rigid.pendingHostVelocity = { v, w }; rigid.geometryRevision++;
    rigid.rcs = structuredClone(assemblyRcs.rcs);
    assemblyRcs.dispose(); assemblyRcs = null; state.assemblyActive = false; state.assemblyAxes = {};
  }
  const departures = createDepartures(flightScene, () => rigid);
  const bridle = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xebe1bc }));
  bridle.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(18), 3));
  bridle.frustumCulled = false;
  bridle.visible = false;
  flightScene.add(bridle);
  let surfaceGroundY = 0;
  const exhaust = makeExhaust();
  ship.add(exhaust.root);
  const ascentSmoke = makeAscentSmoke();
  flightScene.add(ascentSmoke.root);
  const ground = makeLandingGround(suits.apollo);
  flightScene.add(ground.group);
  const cabins = createCabinInteriors(suits);
  const recovery = createRecoveryView();
  flightScene.add(recovery.group);
  const climbFrame = new Quaternion();
  const climbBasis = new Matrix4();
  const climbUp = new Vector3();
  const climbEast = new Vector3();
  const climbSouth = new Vector3();
  const flightFrame = new Quaternion();
  const inverseFrame = new Quaternion();
  const levelFrame = new Quaternion();
  const routeAttitude = new Quaternion();
  const turn = new Quaternion();
  const manualAttitude = new Quaternion();
  const manualAngles = new Euler();
  const forward = new Vector3();
  const desiredForward = new Vector3();
  const padBackgroundCamera = camera.clone();
  const launchSouth = new Vector3().crossVectors(east, launchUp);
  const padFrame = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(east, launchUp, launchSouth));
  const padToFlight = new Quaternion();
  const flightToPad = new Quaternion();
  const emitter = new Vector3();
  const ascentOrigin = new Vector3();
  const padCenter = new Vector3();
  const padOffset = new Vector3();
  const lastPadOffset = new Vector3();
  const padMotion = new Vector3();
  const appliedStages = new Set();
  let nozzleKey = '';
  const vesselCenter = new Vector3();
  const receiverOffset = new Vector3();
  const cabinPoint = new Vector3();
  const cabinDirection = new Vector3();
  const cabinFrame = new Quaternion();
  const cameraInverse = new Quaternion();
  function updatePadOffset() {
    padLocalPosition(state.position.clone().multiplyScalar(1000), padOffset);
    if (state.kind === 'ascent') padOffset.multiplyScalar(shortenedSpaceScale(state));
  }
  const previousClimbOffset = new Vector3();
  const nextClimbOffset = new Vector3();
  let guideClimb = true;
  let cameraMove;
  let lunarSurfaceCamera = null;
  const trackedCenter=new Vector3();
  let trackingCenter=false;
  const coastAttitude=new Quaternion();
  let coastHolding=false;
  controls.addEventListener('start', () => {
    recovery.releaseCamera();
    guideClimb = false;
    cameraMove = undefined;
  });
  const cache = new Map();
  const previousAutoClear = true;
  let space;
  let ascentView;
  let loading = false;
  let active = false;
  let state;
  function earthBackdropBlend() {
    if(bodyView || !['ascent','orbit','moonTransfer'].includes(state.kind))return 0;
    // Leaving parking orbit does not change the scenery. Transition to the
    // distant globe only as the physical trajectory actually leaves Earth.
    return 1-MathUtils.smoothstep(state.position.length()-EARTH_RADIUS,1000,6000);
  }
  const diagnostics = new FlightDiagnostics(document.querySelector('#flight-diagnostics'), () => state, () => {
    const direction = new Vector3(0, 1, 0);
    if (sceneSpace) direction.applyQuaternion(ship.quaternion).applyQuaternion(flightFrame);
    else direction.applyQuaternion(new Quaternion().fromArray(launch.flightTransform().quaternion)).applyQuaternion(padFrame);
    const transform = launch.flightTransform();
    const padAnchor = new Vector3(0, ascentOriginHeight, 0).applyQuaternion(new Quaternion().fromArray(transform.quaternion)).add(new Vector3(...transform.position));
    const modelPosition = sceneSpace ? ship.position.clone().applyQuaternion(flightFrame).add(state.position.clone().multiplyScalar(1000))
      : padAnchor.clone().addScaledVector(upAxis, -ascentOriginHeight).applyQuaternion(padFrame).add(PAD_POSITION_M);
    const cameraOffset = sceneSpace ? camera.position.clone().sub(ship.position).applyQuaternion(flightFrame)
      : camera.position.clone().sub(padAnchor).applyQuaternion(padFrame);
    return { frame: sceneSpace ? 'floating-origin' : 'launchpad', modelUnitM: 1, activeNozzles: exhaust.nozzleCount,
      bodyDirectionECEF: direction.toArray(), thrustDirectionECEF: state.launch.thrustDirection.toArray(),
      attitudeErrorDeg: MathUtils.radToDeg(direction.angleTo(state.launch.thrustDirection)),
      padLocalM: padLocalPosition(state.position.clone().multiplyScalar(1000)).toArray(),
      phase: state.kind, asset: currentAsset, modelId:visual?.uuid, nearbyType, ports: [Boolean(findPart(ship, 'dock_port')), Boolean(findPart(nearby, 'dock_port'))],
      maneuver: presentation ? { label: presentation.label, durationS: presentation.duration, elapsedS: presentation.time } : null,
      earthBackdropBlend:earthBackdropBlend(), sunlightWorld:sun.position.clone().normalize().applyQuaternion(flightFrame).toArray(),
      spaceCamera: space ? { near: space.camera.near, position: space.camera.position.toArray(),
        earthPosition: space.bodies.find(body => body.id === 'earth').mesh.position.toArray() } : null,
      modelPositionErrorM: modelPosition.distanceTo(state.position.clone().multiplyScalar(1000)), cameraOffsetM: cameraOffset.toArray(),
      cameraTargetErrorM:visual?controls.target.distanceTo(new Box3().setFromObject(visual,true).getCenter(new Vector3())):0,
      cameraDistanceM:camera.position.distanceTo(controls.target),missionTimeS:state.totalTime,phaseTimeS:state.time,
      cameraLocalM: camera.position.toArray(), cameraTargetM: controls.target.toArray(), groundY: ground.group.position.y,
      positionKm:state.position.toArray(),velocityKmS:state.velocity.toArray(),trajectoryModel:state.path?.model,actualRate:state.actualRate,rails:state.rails,
      rigid: rigid?.snapshot(), interior: cabins.physicsSnapshot(), earthImagery: space?.imageryInfo,
      damage: state.systems.moduleDamage, cabinPressureKPa: state.systems.cabinPressureKPa };
  }, { push: () => cabins.push(), impact: () => rigid?.strike(), dockFast: () => rigid?.dockingTest('fast'), dockAngle: () => rigid?.dockingTest('angle') });
  let snapshot;
  let visual;
  let halfHeight = 50;
  let ascentOriginHeight = 0;
  let width = 10;
  let sceneSpace = false;
  let runToken = 0;
  let nearbyType;
  let presentation;
  let staged = false;
  let upperStaged = false;
  let boostersReleased = false;
  let seconds = 0;
  let recoverySeconds = 0;
  let lastHud = 0;
  let lastMap = 0;
  let hudAge = Infinity, mapAge = Infinity;
  let globeMap = false;
  let track = [];
  let bodyView = null;
  let cabin = false;
  let cameraId = 'ship';
  let steering = false;
  let currentAsset;
  let cabinPointer;
  let dartEncounter;
  let dartRelease;
  let payloadDeployPending = false;
  let restoring = false;

  const viewport = controls.domElement;
  const flightViewport = viewport.closest('#viewport');
  viewport.addEventListener('pointerdown', event => {
    if (!active || !cabin || !cabins.name || event.button !== 0) return;
    cabinPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (event.pointerId !== cabinPointer?.id || !cabin) return;
    cabins.look(event.clientX - cabinPointer.x, cabinPointer.y - event.clientY);
    cabinPointer.x = event.clientX;
    cabinPointer.y = event.clientY;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(type, event => {
    if (event.pointerId === cabinPointer?.id) cabinPointer = undefined;
  });

  const model = (id) => {
    if (!cache.has(id)) {
      const block = document.getElementById(`flight-data-${id}`);
      if (!block) return Promise.reject(new Error(`Flight model ${id} is missing`));
      cache.set(id, loader.parseAsync(decode(block.textContent).buffer, '').then(({ scene }) => scene)
        .catch((error) => { cache.delete(id); throw error; }));
    }
    return cache.get(id);
  };
  let missionModels = new Map();
  function announce(text) { eventText.textContent = text; }
  function syncFlightFormat() {
    warp.disabled = state.flightLength === 'short';
    if (warp.disabled) warp.value = '1';
  }

  function radioEvent(event) {
    audio.mission(event.detail, state);
    const { type, detail, actualTime } = event.detail;
    const milestone = state.timeline.events.some(item => item.signal === type && item.status === 'COMPLETE'
      && Math.abs(item.actualTime - actualTime) < .05);
    if (!milestone && type !== 'maxQ') journal.record(type, actualTime);
    if (type === 'moduleDamage') announce(`Damage · ${detail.module} · impact ${detail.speedMps.toFixed(1)} m/s`);
    if (type === 'dockingRejected') announce('Docking rejected · speed or angle out of bounds');
    if (type === 'probeContact' || type === 'fuelCall') announce(detail.label);
    if (type === 'equipmentInstalled' && detail.id === 'ladder') announce("Armstrong · One small step for man, one giant leap for mankind.");
  }
  function missionControl(event) { window.dispatchEvent(new CustomEvent('mission-control', { detail: event.detail })); }

  function settleCountdown() {
    // UI commands observe the last committed simulation tick; they never advance
    // a second, independent countdown clock.
    state?.timeline.update();
  }

  function findVesselCenter() {
    if (sceneSpace) return vesselCenter.copy(ship.position);
    return vesselCenter.copy(padOffset).addScaledVector(upAxis, ascentOriginHeight);
  }

  function aimCabin() {
    if (!cabin) { cabins.hide(); return; }
    if (state.kind === 'marsSurface' && state.surfaceExpedition) {
      cabins.hide();
      const e = state.surfaceExpedition, actor = e.current;
      camera.position.copy(ground.group.localToWorld(actor.p.clone().add(new Vector3(0, actor.profile === 'rover' ? 1.55 : .18, 0))));
      const yaw = e.mastYaw, pitch = e.mastPitch;
      cabinDirection.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      controls.target.copy(camera.position).addScaledVector(cabinDirection, 8);
      camera.lookAt(controls.target); return;
    }
    if (state.kind === 'moonSurface') {
      cabins.hide();
      ground.helmet.getWorldPosition(cabinPoint);
      camera.position.copy(cabinPoint).addScaledVector(upAxis, .245);
      controls.target.set(0, ground.group.position.y + halfHeight * .9, 0);
      camera.lookAt(controls.target);
      return;
    }
    cabinFrame.setFromEuler(manualAngles.set(0, MathUtils.degToRad(state.roll + state.yaw), -MathUtils.degToRad(state.pitch)));
    if (state.crew && cabins.pose(visual, landerKinds.has(state.kind), camera, controls,
      sceneSpace ? null : findVesselCenter(), cabinFrame)) return;
    const attitude = sceneSpace ? ship.quaternion : cabinFrame;
    cabinPoint.set(0, halfHeight * .73, width * .19).applyQuaternion(attitude).add(findVesselCenter());
    cabinDirection.set(.72, .33, .67).normalize().applyQuaternion(attitude);
    camera.position.copy(cabinPoint);
    controls.target.copy(cabinPoint).addScaledVector(cabinDirection, 15);
    camera.lookAt(controls.target);
  }

  function mixAudio() {
    const emitter = findVesselCenter();
    receiverOffset.copy(emitter).sub(camera.position);
    const distance = receiverOffset.length();
    receiverOffset.applyQuaternion(cameraInverse.copy(camera.quaternion).invert());
    const listenerAltitude = state.altitude + (camera.position.y - emitter.y) * .001;
    audio.mix({
      cabin, distance, engine: state.enginePower, pressure: state.systems.pressure,
      pan: MathUtils.clamp(receiverOffset.x / Math.max(distance, 1), -1, 1),
      density: bodyView ? 0 : Math.min(state.systems.density, airDensity(state.kind, listenerAltitude)),
    });
  }

  function updateFlightFrame(dt) {
    if (state.kind === 'ascent' || state.kind === 'orbit') {
      climbUp.copy(state.position).normalize();
      climbEast.copy(east).addScaledVector(climbUp, -east.dot(climbUp)).normalize();
      climbSouth.crossVectors(climbEast, climbUp);
      climbFrame.setFromRotationMatrix(climbBasis.makeBasis(climbEast, climbUp, climbSouth));
      flightFrame.copy(climbFrame);
    } else {
      let vertical;
      if (landerKinds.has(state.kind)) vertical = state.position.clone().sub(MOON);
      else if (state.kind === 'marsLanding' || state.kind === 'marsSurface') vertical = state.position.clone().sub(state.bodyCenter('mars'));
      else if (state.kind === 'reentry') vertical = state.position.clone();
      if (vertical) {
        levelFrame.setFromUnitVectors(upAxis, vertical.normalize());
        flightFrame.slerp(levelFrame, 1 - Math.exp(-4 * dt));
      }
    }
    inverseFrame.copy(flightFrame).invert();
  }

  function updateShipAttitude(dt) {
    if (state.mode === 'manual' && controlContext(state).actorId === 'columbia' && rigid?.host) {
      ship.quaternion.copy(inverseFrame).multiply(rigid.host.q); routeAttitude.copy(ship.quaternion); return;
    }
    if (state.localAscent && state.kind === 'rendezvous' && state.localAscent.status !== 'orbit') {
      const a = state.localAscent, f = state.ascentFrame, v = new Vector3(0, 1, 0).applyQuaternion(a.q);
      desiredForward.set(0, 0, 0).addScaledVector(new Vector3(...f.east), v.x).addScaledVector(new Vector3(...f.up), v.y).addScaledVector(new Vector3(...f.north), v.z).applyQuaternion(inverseFrame);
      ship.quaternion.setFromUnitVectors(upAxis, desiredForward); routeAttitude.copy(ship.quaternion); return;
    }
    if (state.localLanding && ['moonLanding', 'marsLanding'].includes(state.kind)) {
      ship.quaternion.copy(state.localLanding.q); routeAttitude.copy(ship.quaternion); return;
    }
    if (state.kind === 'ascent') {
      coastHolding=false;
      desiredForward.copy(state.launch.thrustDirection).applyQuaternion(inverseFrame);
      ship.quaternion.setFromUnitVectors(upAxis, desiredForward)
        .multiply(turn.setFromAxisAngle(upAxis, MathUtils.degToRad(state.roll)));
      routeAttitude.copy(ship.quaternion);
      return;
    }
    if (state.mode === 'manual' && state.manualControl.attitude) {
      coastHolding = false;
      routeAttitude.copy(inverseFrame).multiply(state.manualControl.attitude);
      ship.quaternion.copy(routeAttitude);
      return;
    }
    const passiveSolarFlight = !state.engine && (state.interplanetary?.departed || state.solarFlight && state.path?.physical);
    if (passiveSolarFlight || state.realTimeLunar && (state.kind === 'orbit' || state.path?.physical && !state.engine)) {
      if(!coastHolding){coastAttitude.copy(flightFrame).multiply(routeAttitude);coastHolding=true;}
      routeAttitude.copy(inverseFrame).multiply(coastAttitude);
      ship.quaternion.copy(routeAttitude);return;
    }
    coastHolding=false;
    const upright = landerKinds.has(state.kind) || state.kind === 'marsLanding' || state.kind === 'marsSurface' || state.kind === 'reentry';
    if (upright) {
      const landing = state.kind === 'moonLanding' || state.kind === 'marsLanding';
      const tilt = landing ? -.26 * Math.sin(Math.PI * state.progress) ** 2
        : state.kind === 'rendezvous' ? .30 * Math.sin(Math.PI * MathUtils.smoothstep(state.progress, .17, .75)) : 0;
      desiredForward.copy(state.path?.physical&&state.engine?state.properAccelerationMps2.clone().normalize():state.heading).applyQuaternion(inverseFrame);
      desiredForward.y = 0;
      desiredForward.normalize().multiplyScalar(tilt).add(upAxis).normalize();
      routeAttitude.rotateTowards(turn.setFromUnitVectors(upAxis, desiredForward), 4 * dt);
    } else {
      desiredForward.copy(state.path?.physical&&state.engine?state.properAccelerationMps2.clone().normalize():state.heading).applyQuaternion(inverseFrame);
      forward.set(0, currentAsset === 'dart' ? 0 : 1, currentAsset === 'dart' ? 1 : 0).applyQuaternion(routeAttitude);
      turn.setFromUnitVectors(forward, desiredForward).multiply(routeAttitude);
      routeAttitude.rotateTowards(turn, 5 * dt);
    }
    ship.quaternion.copy(routeAttitude);
  }

  function climbOffset(altitude, target) {
    const progress = MathUtils.smoothstep(altitude, 0.08, 4);
    const distance = Math.max(14, halfHeight * 4.1, width * 3.4);
    return target.set(.79, MathUtils.lerp(.27, .12, progress), .58).multiplyScalar(distance);
  }

  function guideLaunchCamera(altitude) {
    if (!guideClimb || staged || bodyView || cabin) return;
    climbOffset(altitude, nextClimbOffset);
    camera.position.add(nextClimbOffset).sub(previousClimbOffset);
    previousClimbOffset.copy(nextClimbOffset);
  }

  function frameShip(distance = Math.max(halfHeight * 4, width * 2.7), smooth = false, target) {
    if (bodyView || cabin) return;
    const d = MathUtils.clamp(distance, 9, 420);
    const center = target ?? (visual ? new Box3().setFromObject(visual, true).getCenter(new Vector3()) : new Vector3());
    if (smooth) {
      const direction = state.kind === 'moonSurface' || state.kind === 'moonLanding' && state.altitude <= 2
        ? new Vector3(.65, .3, 1).normalize() : camera.position.clone().sub(controls.target).normalize();
      cameraMove = { time: 0, follow:true, from: camera.position.clone().sub(center), look: controls.target.clone().sub(center),
        position: direction.multiplyScalar(d) };
    } else {
      cameraMove = undefined;
      camera.position.set(d * 0.42, d * 0.22, d).add(center);
      controls.target.copy(center);
    }
    trackedCenter.copy(center);trackingCenter=true;
    const currentDistance = camera.position.distanceTo(controls.target);
    controls.minDistance = Math.min(Math.max(2.5, halfHeight * 0.8), currentDistance);
    controls.maxDistance = Math.max(250, halfHeight * 14, currentDistance);
    controls.update();
  }
  function replaceVisual(root, recenter = true) {
    visual?.removeFromParent();
    visual = root;
    const box = new Box3().setFromObject(root, true);
    const center = box.getCenter(new Vector3());
    if (recenter) root.position.sub(center);
    const size = box.getSize(new Vector3());
    halfHeight = size.y / 2;
    width = Math.max(size.x, size.z);
    root.traverse((part) => { if (part.isMesh) part.castShadow = part.receiveShadow = true; });
    ship.add(root);
    exhaust.bind(root);
    if (sceneSpace) frameShip(undefined, true);
  }
  function stripServiceModule(root) {
    const pieces = ['apollo_sm', 'orion_esm', 'orion_cma', 'dragon_trunk'].map(id => findPart(root, id)).filter(Boolean);
    for (const item of pieces) departures.release(item, departureVector(0, -4.1, 1.4), .20);
    return pieces.length > 0;
  }
  function showShip(asset) {
    const key = asset;
    if (key === currentAsset) return;
    const clone = missionModels.get(asset).clone(true);
    replaceVisual(clone);
    currentAsset = key;
  }

  function departureVector(x, y, z) { return new Vector3(x, y, z).applyQuaternion(ship.quaternion); }

  function present(label, duration, pose, finish) {
    presentation = { label, duration, pose, finish, time: 0 };
    skipManeuverButton.hidden = false;
    skipManeuverButton.disabled = false;
    skipManeuverButton.title = label;
    announce(label);
  }

  let skippingStage = false;
  skipManeuverButton.addEventListener('click', async () => {
    if (!active || state.failed || state.aborted || state.complete || restoring || skippingStage) return;
    if (!presentation) {
      skippingStage = true;
      skipManeuverButton.disabled = true;
      const current = state;
      try {
        const label = await state.skipNextEvent({ onPhaseChange: () => { phaseChanged(); return false; },
          onStep: simulationHardware, canRail: canRailFlight, onCoastJump: () => rigid.discardDebris(),
          shouldStop: () => Boolean(presentation) || !active || state !== current,
          yieldFrame: () => new Promise(resolve => requestAnimationFrame(resolve)) });
        seconds = state.totalTime;
        announce(`Phase skipped · ${label}`);
      } finally { skippingStage = false; clearInput(); telemetry(); updateMap(); }
      return;
    }
    const action = presentation;
    skipManeuverButton.disabled = true;
    const advanced = state.skipPresentation(Math.max(0, action.duration - action.time));
    if (state.failed || state.aborted) { telemetry(); return; }
    finishSkippedManeuver(action);
    rigid.discardDebris();
    presentation = undefined;
    clearInput();
    seconds = state.totalTime;
    updateFlightFrame(0);
    updateShipAttitude(0);
    rigid.setFrame(flightFrame);
    rigid.syncHost(visual, ship, state);
    state.report('maneuverSkipped', { label: action.label, seconds: advanced });
    telemetry();
    updateMap();
    announce(`Maneuver skipped · ${action.label}`);
  });

  function adopt(root, asset, label, duration, pose, upright = false, settling = 1) {
    visual = root;
    currentAsset = asset;
    const bounds = relativeBounds(root, ship);
    const size = bounds.getSize(new Vector3());
    halfHeight = size.y / 2;
    width = Math.max(size.x, size.z);
    const from = root.position.clone();
    const startRotation = root.quaternion.clone();
    const targetRotation = upright ? new Quaternion() : startRotation;
    const target = from.clone().sub(bounds.getCenter(new Vector3()));
    if (upright) {
      const local = relativeBounds(root, root);
      target.copy(local.getCenter(new Vector3())).multiplyScalar(-1);
      halfHeight = local.getSize(size).y / 2;
      width = Math.max(size.x, size.z);
    }
    exhaust.bind(root);
    const startCenter = bounds.getCenter(new Vector3()).applyQuaternion(ship.quaternion).add(ship.position);
    frameShip(Math.max(24, halfHeight * 5.2, width * 4), true, startCenter);
    present(label, duration, p => {
      const u = MathUtils.smoothstep(p, 0, settling);
      root.position.lerpVectors(from, target, u);
      root.quaternion.slerpQuaternions(startRotation, targetRotation, u);
      pose?.(p);
    }, () => {
      const deployedSize = relativeBounds(root, ship).getSize(new Vector3());
      halfHeight = deployedSize.y / 2;
      width = Math.max(deployedSize.x, deployedSize.z);
      frameShip(undefined, true);
    });
  }

  function deployPayload() {
    const asset = state.mission.payload;
    const previous = visual;
    const payload = captureParts(ship, previous, orbitalPayloads[asset] ?? []);
    if (!payload) { showShip(asset); return; }
    let fairings = 0;
    for (const [i, id] of fairingParts.entries()) {
      const angle = i * 2.399963;
      if (departures.release(findPart(previous, id), departureVector(5 * Math.cos(angle), .6, 5 * Math.sin(angle)), .34, 7)) fairings++;
    }
    if (fairings) state.report('fairingSeparated', { count: fairings });
    departures.release(previous, departureVector(0, -10, 1.7), .055, 14);
    state.report('payloadSeparated');
    if (asset === 'dragon') state.report('dragonSeparated', { separated: true }, 'dragonSeparated');
    const apollo = asset === 'apollo_docked';
    const dart = asset === 'dart';
    const pose = apollo ? apolloTransposition(payload) : dart
      ? deployDartArrays(payload, missionModels.get(asset), cover => departures.release(cover, departureVector(0, .4, 2), .16, 7))
      : deploymentPose(payload, missionModels.get(asset));
    const duration = apollo ? apolloExtractionDuration(state) : dart ? 4.8 : 3.2;
    adopt(payload, asset, apollo ? 'Columbia turns to dock with Eagle' : dart
      ? 'DART separation and ROSA deployment' : 'Payload separation',
      duration, p => {
        pose(p);
        if (dart && p >= 1) state.report('rosaDeployed', { arrays: 2, extended: true }, 'rosaDeployed');
        if (asset === 'voyager' && p >= 1) {
          const booms = ['voyager_mag_boom', 'voyager_rtg_boom'].filter(id => findPart(payload, id));
          state.report('voyagerBooms', { booms: booms.length, deployed: true }, 'voyagerBooms');
        }
        if (asset === 'dragon' && p >= 1 && findPart(payload, 'dock_port')) state.report('dragonNoseOpen', { portExposed: true }, 'dragonNoseOpen');
        if (apollo && rigid.confirmAssemblyCapture(findPart(payload,'columbia_csm'),findPart(payload,'eagle_lm'),p,duration)) state.report('dock', { target: 'eagle' }, 'apolloTransposition');
      });
    if (apollo && state.objectivesEnabled && !restoring) {
      assemblyRcs?.dispose();
      assemblyRcs = new AssemblyRcs(rigid.runtime, findPart(payload, 'columbia_csm'), findPart(payload, 'eagle_lm'), (type, detail) => state.report(type, detail));
      assemblyRcs.rcs = structuredClone(rigid.rcs); state.assemblyActive = true;
      presentation.duration = Infinity;
    }
  }

  function renderMarsEdl() {
    const edl = state.marsEdl;
    if (state.kind !== 'marsLanding' || !edl) return;
    const rover = findPart(visual, state.mission.rover), crane = findPart(visual, 'mars_descent_stage');
    if (!rover || !crane || edl.ropeM <= 0) return;
    if (!rover.userData.edlStart) {
      visual.attach(rover);
      rover.userData.edlStart = rover.position.toArray();
      crane.userData.edlStart = crane.position.toArray();
    }
    rover.position.fromArray(rover.userData.edlStart).y -= edl.ropeM;
    crane.position.fromArray(crane.userData.edlStart).add(new Vector3(edl.craneDistanceM, Math.max(0, edl.craneAltitudeM - edl.heightM), 0));
    bridle.visible = edl.tethers && edl.ropeM > 0;
    if (!bridle.visible) return;
    ship.updateWorldMatrix(true, true);
    const point = new Vector3(), cables = bridle.geometry.attributes.position;
    for (let i = 1; i <= 3; i++) {
      (findPart(crane, `bridle_0${i}`) ?? crane).getWorldPosition(point);
      cables.setXYZ((i - 1) * 2, point.x, point.y, point.z);
      (findPart(rover, `mount_bridle_0${i}`) ?? rover).getWorldPosition(point);
      cables.setXYZ((i - 1) * 2 + 1, point.x, point.y, point.z);
    }
    cables.needsUpdate = true;
  }
  function landOnMars() {
    const roverId = state.mission.rover;
    const rover = captureParts(ship, visual, [roverId]);
    if (!rover) { showShip(roverId); return; }
    const crane = findPart(visual, 'mars_descent_stage');
    const previous = visual;
    previous.removeFromParent();
    if (crane) {
      crane.removeFromParent();
      ship.add(crane);
      crane.quaternion.identity();
    }
    const tether = new Vector3();
    const cables = bridle.geometry.attributes.position;
    const ends = [1, 2, 3].map(i => [findPart(crane, `bridle_0${i}`), findPart(rover, `mount_bridle_0${i}`)]);
    if (crane && ends.every(([top, bottom]) => top && bottom)) state.report('skyCrane');
    adopt(rover, roverId, 'Rover touchdown and sky crane departure', 4.0, p => {
      const descent = MathUtils.smoothstep(p, 0, .64);
      rover.position.y += 5.0 * (1 - descent);
      if (descent === 1 && state.surface !== 'mars') {
        state.surface = 'mars';
        state.altitude = state.speed = 0;
        state.report('marsTouch');
      }
      if (!crane) return;
      const away = MathUtils.smoothstep(p, .64, 1);
      crane.position.set(away * 18, 7.4 + 4 * away, -away * 12);
      bridle.visible = away === 0;
      if (bridle.visible) {
        for (const [i, [top, bottom]] of ends.entries()) {
          (top ?? crane).getWorldPosition(tether);
          cables.setXYZ(i * 2, tether.x, tether.y, tether.z);
          (bottom ?? rover).getWorldPosition(tether);
          if (!bottom) tether.y += .9;
          cables.setXYZ(i * 2 + 1, tether.x, tether.y, tether.z);
        }
        cables.needsUpdate = true;
      }
      if (p >= 1) departures.release(crane, departureVector(8, 3, -5), .09, 5);
    }, true, .64);
  }
  function nearbyModel(id) {
    const root = missionModels.get(id).clone(true);
    const bounds = new Box3().setFromObject(root, true);
    root.position.sub(bounds.getCenter(new Vector3()));
    nearby.clear();
    nearby.add(root);
  }
  function separateLander() {
    const eagle = findPart(visual, 'eagle_lm');
    if (eagle) {
      nearby.position.copy(ship.position);
      nearby.quaternion.copy(ship.quaternion);
      nearby.attach(eagle);
      currentAsset = 'columbia';
      frameShip(Math.max(34, halfHeight * 5), true);
    } else {
      showShip('columbia');
      nearbyModel('eagle');
    }
    nearbyType = 'eagle';
  }
  function stageRocket() {
    if (!active || state.paused || state.failed || state.complete || state.kind !== 'ascent') return;
    state.separateStage();
    syncLaunchHardware();
  }
  function syncLaunchHardware() {
    for (let i = 0; i < state.launch.stages.length; i++) {
      if (state.launch.stages[i].attached || appliedStages.has(i)) continue;
      const spec = state.launch.vehicle.stages[i];
      const released = spec.assemblyKeys ? captureAssemblyStage(ship, visual, spec.parts, state.launch.vehicle.stages.slice(i + 1).flatMap(stage => stage.parts))
        : captureParts(ship, visual, spec.parts.filter(id => findPart(visual, id)));
      departures.release(released, departureVector(0, -1.2, .18), .08, 18, spec.dryMassKg + state.launch.stages[i].fuelKg);
      appliedStages.add(i);
      staged ||= i === 0;
      upperStaged ||= i === 1;
      exhaust.bind(visual);
      frameShip(undefined, true);
    }
    if (state.launch.boosters && !state.launch.boosters.attached && !boostersReleased) separateBoosters();
    const active = [];
    const p = state.launch;
    if (p.time >= p.stageIgnitionAt && p.stages[p.stageIndex].fuelKg > 0 && !p.stages[p.stageIndex].failed) {
      const stage = p.vehicle.stages[p.stageIndex];
      active.push(...(stage.assemblyKeys ? stage.engineKeys : stage.parts));
    }
    if (p.boosters?.attached && !p.boosters.failed && p.boosters.fuelKg > 0) active.push(...p.vehicle.boosters.parts);
    const poweredAssembly = p.vehicle.stages[p.stageIndex].assemblyKeys;
    const key = `${poweredAssembly ? 'assembly:' : ''}${active.join('|')}`;
    if (key !== nozzleKey) { exhaust.bind(visual, poweredAssembly || active.length ? active : null); ascentSmoke.breakEmission(); nozzleKey = key; }
  }
  function separateBoosters() {
    const parts = [];
    visual.traverse(item => {
      if (/^(sls_srb_[lr]|atlas_v_srb_\d+|titan_srb_[lr])$/.test(item.userData.partId ?? '')) parts.push(item);
    });
    for (const part of parts) {
      const radial = ship.worldToLocal(part.getWorldPosition(new Vector3()));
      radial.y = 0;
      radial.normalize().multiplyScalar(5.8).addScaledVector(upAxis, -5.1).applyQuaternion(ship.quaternion);
      departures.release(part, radial, .24, 18, state.launch.vehicle.boosters.dryMassKg / Math.max(1, parts.length));
    }
    if (parts.length) exhaust.bind(visual);
    boostersReleased = true;
  }
  // Called for every physics substep, including low-FPS/time-warp updates.
  function simulationHardware(_state, step = 0) {
    if (state.paused || state.failed || state.aborted) return;
    const dart = state.objectivesEnabled && state.historicalOperations?.dart;
    if (dart && state.kind === 'dartApproach' && state.progress >= 1 && !dart.impact) {
      dart.impact = dartEncounter.measureImpact(dart.dispersionM);
      state.report('dartMeasuredImpact', dart.impact, 'dartMeasuredImpact');
      if (dart.impact.target !== 'dimorphos') { state.fail(dart.impact.target === 'didymos' ? 'Didymos impact' : 'Missed Dimorphos'); return; }
    }
    if (assemblyRcs) {
      assemblyRcs.advance(step, state.assemblyAxes, state.manualControl, state.mode !== 'manual'); state.assemblyAxes = {}; return;
    }
    ground.physicsStep(state, step);
    updateFlightFrame(step);
    updateShipAttitude(step);
    rigid.setFrame(flightFrame);
    rigid.syncHost(visual, ship, state);
    if (state.kind === 'ascent') {
      syncLaunchHardware();
      if (state.launch.vehicle.fairingMassKg > 0 && !state.launch.fairingAttached && !state.reported.has('ascentFairing')) {
        let count = 0;
        for (const [i, id] of fairingParts.entries()) if (departures.release(findPart(visual, id), departureVector(i % 2 ? -5 : 5, .6, 1), .2, 7)) count++;
        state.reported.add('ascentFairing');
      }
    }
    if (state.kind === 'marsLanding') {
      const edl = state.marsEdl;
      if ((edl ? edl.chute : state.altitude < 13) && !findPart(visual, 'mars_parachute') && findPart(visual, 'mars_backshell')) {
        const shell = findPart(visual, 'mars_backshell');
        findPart(shell, 'parachute_cover')?.removeFromParent();
        const chute = missionModels.get('mars_parachute').clone(true);
        chute.position.set(0, 2.22, 0);
        shell.add(chute);
        state.report('marsParachute', {}, 'marsParachute');
      }
      if ((edl ? !edl.heatshield : state.altitude < 8) && departures.release(findPart(visual, 'mars_heatshield'), departureVector(1.7, -5, 1), .22)) state.report('heatshieldSeparated', { separated: true });
      if ((edl ? !edl.backshell : state.altitude < 3) && departures.release(findPart(visual, 'mars_backshell'), departureVector(-5, 2, 3), .19)) state.report('poweredDescent');
    }
    rigid.syncHost(visual, ship, state);
    if (dragonRetreat && state.kind === 'earthReturn' && step > 0 && !dragonRetreat.fired) {
      rigid.exterior.impulse(rigid.host, dragonRetreat.away.clone().multiplyScalar(rigid.host.mass * .25));
      dragonRetreat.fired = true;
    }
    if(state.rails&&step>0){rigid.rail(step);cabins.coast(step,visual);}
    else {
      rigid.advance(step);
      if (dragonRetreat?.fired && state.kind === 'earthReturn') {
        const deltaVMps = fromPx(rigid.host.actor.getLinearVelocity()).sub(dragonRetreat.before).dot(dragonRetreat.away);
        if (deltaVMps > .2) {
          state.report('retreatBurn', { deltaVMps, undocked: !rigid.joint }, 'dragonRetreat');
          dragonRetreat = null;
        }
      }
      if (step > 0) cabins.physicsStep(step, rigid.cabinMotion(step), visual);
    }
  }
  function phaseChanged() {
    if (lunarSurfaceCamera) { controls.minPolarAngle = .02; controls.maxPolarAngle = Math.PI - .02; }
    lunarSurfaceCamera = null;
    clearInput();
    if (assemblyRcs) endAssembly();
    const kind = state.kind;
    const departingDragon = kind === 'earthReturn' && state.id === 'iss_resupply' && rigid?.joint;
    const away = departingDragon ? rigid.host.p.clone().sub(rigid.target.p).normalize() : null;
    if (!['docking', 'rendezvous', 'stationApproach'].includes(kind)) rigid?.clearDock();
    if (departingDragon) {
      state.report('undocked', { jointReleased: !rigid.joint }, 'dragonUndocked');
      dragonRetreat = { before: fromPx(rigid.host.actor.getLinearVelocity()), away, fired: false };
    }
    if(kind === 'moonLanding') rigid?.endFreeModule();
    const previousType = nearbyType;
    if (kind === 'earthReturn' && previousType === 'columbia' && state.dockingLocked && state.loadedSampleKg >= 20 && state.lifeSupport) {
      for (const member of state.lifeSupport.crew) member.module = 'columbia';
      state.report('crewAndSamplesTransferred', { crewCount: state.lifeSupport.crew.length, sampleKg: state.loadedSampleKg, target: 'columbia' }, 'crewAndSamplesTransferred');
    }
    const pickup = kind === 'moonLanding' && previousType === 'eagle' ? captureParts(ship, nearby, ['eagle_lm'])
      : kind === 'earthReturn' && previousType === 'columbia' ? captureParts(ship, nearby, ['columbia_csm']) : null;
    if (kind === 'earthReturn' && previousType === 'iss') {
      if (!departingDragon) departures.release(nearby.children[0], departureVector(-8, -9, -4), .016, 16);
    }
    nearbyType = undefined;
    nearby.clear();
    nearby.visible = true;
    nearby.rotation.set(0, 0, 0);
    nearby.position.set(0, 0, 0);
    if (kind !== 'rendezvous') surfaceHardware.clear();
    if (kind !== 'orbit' && rigid?.proximity) { rigid.exterior.remove(rigid.proximity.body); rigid.proximity = null; }
    recovery.reset();
    recoverySeconds = 0;
    ground.group.visible = false;
    if (kind === 'orbit' && state.mission.payload && state.id !== 'apollo_11') {
      if (state.id !== 'artemis_ii' || !state.objectivesEnabled || state.historicalOperations.flags.icpsBurnDone) deployPayload();
      if (state.id === 'artemis_ii' && state.objectivesEnabled && state.historicalOperations.flags.icpsBurnDone) { nearbyType = 'icps'; nearbyModel('icps'); }
    }
    if (kind === 'orbit' && state.satellite?.orbit) {
      departures.release(visual, departureVector(0, -6, 1), .04, 8);
      showShip(state.mission.satelliteModel);
      announce('Payload separated');
    }
    if (kind === 'planetTransfer' || kind === 'planetOrbit' || kind === 'planetFlyby') {
      if (!restoring && kind === 'planetTransfer') {
        rigid.discardDebris();
        departures.release(visual, departureVector(0, -6, 1), .04, 8);
      }
      showShip(state.mission.probeModel);
    }
    if (kind === 'moonTransfer' && state.id === 'apollo_11') payloadDeployPending = true;
    if (kind === 'moonTransfer' && state.lunar?.isolated) {
      const i = state.launch.stageIndex;
      const stageKg = state.launch.vehicle.stages[i].dryMassKg + state.launch.stages[i].fuelKg;
      const stage = captureParts(ship, visual, state.launch.vehicle.stages[i].parts.filter(id => findPart(visual, id)));
      if (!restoring) departures.release(stage, departureVector(0, -6, 1), .04, 8, stageKg);
      else stage?.removeFromParent();
      showShip(state.mission.capsule);
    }
    if (kind === 'separate') {
      separateLander();
      rigid.detachNearby(nearby,nearby.children[0],departureVector(1.8,1.2,0));
      state.report('undock', {}, 'eagleSeparate');
    } else if (landerKinds.has(kind)) {
      if (pickup) {
        departures.release(visual, departureVector(-2, 4, -1), .05);
        adopt(pickup, 'eagle', 'Eagle turning for landing', 2.8, undefined, true);
      } else showShip('eagle');
      if (kind === 'rendezvous') {
        const descent = findPart(visual, 'eagle_descent');
        if (descent) {
          surfaceHardware.position.set(0, 0, 0);
          surfaceHardware.attach(descent);
          surfaceGroundY = new Box3().setFromObject(surfaceHardware, true).min.y;
          exhaust.bind(visual);
          frameShip(38, true, new Vector3(0, 3, 0));
        }
        nearby.visible = false;
        nearbyType = 'columbia';
        nearbyModel('columbia');
      }
    } else if (kind === 'earthReturn' && state.mission.capsule) {
      if (pickup) {
        departures.release(visual, departureVector(-2, -4, 1), .065);
        adopt(pickup, 'columbia', 'Columbia departing Eagle', 2.5, undefined, true);
      } else showShip(state.mission.capsule);
    } else if (kind === 'reentry' && state.mission.capsule) {
      showShip(state.mission.capsule);
      if (stripServiceModule(visual)) {
        state.report('serviceSeparated', { separated: true }, 'serviceSeparated');
        if (state.id === 'iss_resupply') state.report('trunkSeparated', { separated: true }, 'trunkSeparated');
        adopt(visual, state.mission.capsule, 'Service module separation', 2.6, undefined, true);
      }
    } else if (kind === 'marsLanding') {
      if (departures.release(findPart(visual, 'mars_cruise_stage'), departureVector(-4, 2.6, 1), .16)) state.report('cruiseSeparated', { separated: true }, 'marsCruiseSeparated');
    } else if (kind === 'marsSurface') {
      if (state.marsEdl?.phase === 'completed') showShip(state.mission.rover);
      else if (!state.sceneSurfaceTrial) landOnMars();
    } else if (kind === 'stationApproach' || kind === 'docking') {
      nearbyType = 'iss';
      nearbyModel('iss');
    } else if (kind === 'dartRelease') {
      dartRelease = releaseLiciacube(visual, missionModels.get('dart'), missionModels.get('liciacube'));
      bodyView = null;
      cabin = false;
      cameraId = 'ship';
      cockpit.hidden = true;
      controls.enabled = true;
      const cube = findPart(visual, 'liciacube');
      const center = cube.getWorldPosition(new Vector3());
      const orientation = cube.parent.getWorldQuaternion(new Quaternion());
      cameraMove = { time: 0, from: camera.position.clone(), look: controls.target.clone(),
        center: center.clone().add(new Vector3(.15, 0, 1.3).applyQuaternion(orientation)),
        position: center.clone().add(new Vector3(3.1, 1.8, 6.6).applyQuaternion(orientation)) };
    } else if (isDartEncounter(kind)) {
      if(state.solarFlight)dartEncounter.impactOrigin.copy(state.dartImpactOrigin);
      bodyView = null;
      cabin = false;
      cameraId = 'ship';
      cameraMove = undefined;
      cockpit.hidden = true;
      controls.enabled = false;
      cabins.hide();
      dartEncounter.update(state, 0, false);
    }
    if (kind === 'moonSurface') {
      frameShip(Math.max(35, width * 3.8), true, new Vector3(4, -halfHeight * .3, 2));
    }
    document.querySelector('#flight-map-title').textContent = ['ascent', 'orbit'].includes(kind)
      ? 'Florida · ground track' : state.mission.destination;
    document.querySelector('#location-tag').textContent = state.interplanetary?.departed
      ? `${bodyNames[state.design.spec.destination]} / ${kind === 'planetOrbit' ? 'orbit' : kind === 'planetFlyby' ? 'flyby' : 'transfer'}`
      : phaseLocation[kind] ?? 'Interplanetary flight';
    if (kind === 'reentry') {
      document.querySelector('#flight-map-title').textContent = 'Earth return';
    }
    if (!presentation) announce('');
    if (!restoring) {
      stageCheckpoint = { version: 1, state: state.serialize(), rigid: kind === 'docking' ? rigid.serialize() : null,
        interior: cabins.serializePhysics(), visual: { staged, upperStaged, boostersReleased, recoverySeconds } };
    }
    telemetry();
    return state.realTimeLunar||!presentation;
  }

  function updateMap() {
    if (!space) return;
    const kind = state.kind;
    if (kind === 'dartRelease' || isDartEncounter(kind)) {
      mapToggle.hidden = true;
      map.setAttribute('aria-label', 'Didymos system and DART approach');
      document.querySelector('#flight-map-title').textContent = 'Didymos and Dimorphos · approach';
      mapContext.fillStyle = '#101c29';
      mapContext.fillRect(0, 0, map.width, map.height);
      mapContext.strokeStyle = '#75889666';
      mapContext.beginPath(); mapContext.ellipse(162, 125, 220, 74, 0, 0, Math.PI * 2); mapContext.stroke();
      mapContext.fillStyle = '#8c8b83';
      mapContext.beginPath(); mapContext.arc(162, 125, 39, 0, Math.PI * 2); mapContext.fill();
      mapContext.fillStyle = '#b0a899';
      mapContext.beginPath(); mapContext.arc(382, 125, 13, 0, Math.PI * 2); mapContext.fill();
      mapContext.font = '13px Segoe UI,Arial';
      mapContext.fillStyle = '#e2e8e6';
      mapContext.fillText('Didymos', 129, 184); mapContext.fillText('Dimorphos', 357, 96);
      const range = isDartEncounter(kind) ? dartEncounter.range : state.dartRange;
      const x = 382 - Math.min(1, range / 2600) * 130;
      mapContext.strokeStyle = '#e9b467';
      mapContext.setLineDash([4, 5]);
      mapContext.beginPath(); mapContext.moveTo(246, 125); mapContext.lineTo(369, 125); mapContext.stroke();
      mapContext.setLineDash([]);
      mapContext.fillStyle = '#8df5d4';
      mapContext.fillRect(x - 3, 122, 6, 6); mapContext.fillText('DART', x - 16, 150);
      return;
    }
    const name = bodyView ?? (moonKinds.has(kind) || kind === 'moonTransfer' ? 'Moon'
      : kind.startsWith('mars') ? 'Mars' : kind.startsWith('jupiter') ? 'Jupiter'
        : kind.startsWith('saturn') || kind === 'escape' ? 'Saturn' : 'Earth');
    const body = space.bodies.find(item => item.name === name);
    const earth = name === 'Earth';
    const p = state.position.clone().sub(body.origin).normalize().applyQuaternion(body.mesh.quaternion.clone().invert());
    const lat = MathUtils.radToDeg(Math.asin(MathUtils.clamp(p.y, -1, 1)));
    const lon = MathUtils.radToDeg(Math.atan2(-p.z, p.x));
    if (earth && state.totalTime > 0 && ['ascent', 'orbit'].includes(kind)) {
      track.push([lon, lat]);
    }
    const zoom = earth && !globeMap && kind === 'ascent';
    const west = zoom ? -91 : -180;
    const east = zoom ? -67 : 180;
    const north = zoom ? 35 : 90;
    const south = zoom ? 23 : -90;
    const x = (longitude) => (longitude - west) / (east - west) * map.width;
    const y = (latitude) => (north - latitude) / (north - south) * map.height;
    const image = body.image;
    mapToggle.hidden = !earth || kind !== 'ascent';
    document.querySelector('#flight-map-title').textContent = zoom ? 'Florida · ground track' : `${name} · map`;
    if (image) mapContext.drawImage(image, (west + 180) / 360 * image.width, (90 - north) / 180 * image.height,
      (east - west) / 360 * image.width, (north - south) / 180 * image.height, 0, 0, map.width, map.height);
    else {
      mapContext.fillStyle = '#273440'; mapContext.fillRect(0, 0, map.width, map.height);
      mapContext.fillStyle = '#e4ebeb'; mapContext.fillText('Map unavailable', 14, 25);
    }
    mapContext.fillStyle = '#061b2320'; mapContext.fillRect(0, 0, map.width, map.height);
    mapContext.strokeStyle = '#d0f3ef33'; mapContext.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      mapContext.beginPath(); mapContext.moveTo(i * map.width / 6, 0); mapContext.lineTo(i * map.width / 6, map.height); mapContext.stroke();
    }
    if (earth) {
      mapContext.strokeStyle = '#f7b660'; mapContext.lineWidth = 2;
      mapContext.beginPath();
      for (const [i, [longitude, latitude]] of track.entries()) {
        if (i === 0 || Math.abs(longitude - track[i - 1][0]) > 180) mapContext.moveTo(x(longitude), y(latitude));
        else mapContext.lineTo(x(longitude), y(latitude));
      }
      mapContext.stroke();
      mapContext.fillStyle = '#ffd69b';
      mapContext.beginPath(); mapContext.arc(x(FLORIDA.lon), y(FLORIDA.lat), 4, 0, Math.PI * 2); mapContext.fill();
      mapContext.font = '700 13px "Segoe UI",Arial';
      mapContext.fillText('Florida', x(FLORIDA.lon) + 9, y(FLORIDA.lat) - 8);
    }
    if (state.position.distanceTo(body.origin) < body.radius * 3) {
      mapContext.fillStyle = '#a6f0d3';
      mapContext.beginPath(); mapContext.arc(x(lon), y(lat), 4, 0, Math.PI * 2); mapContext.fill();
    }
  }
  function telemetry() {
    rocketView.update();
    localView.update();
    objectiveView.update(storage);
    cubeControls.hidden = !(state.objectivesEnabled && state.kind === 'dartAftermath');
    if (!cubeControls.hidden) cubeControls.querySelector('output').textContent = `Frames ${state.historicalOperations.dart.cubeFrames.length} · ${Math.round(state.progress * 360)} s after impact`;
    let rcsHud = panel.querySelector('#rcs-readings');
    if (!rcsHud) { rcsHud = document.createElement('output'); rcsHud.id = 'rcs-readings'; rcsHud.className = 'flight-key-hint'; panel.append(rcsHud); }
    rcsHud.hidden = !rigid?.rcs || controlContext(state).profile !== 'spacecraft';
    const d = assemblyRcs?.metrics ? { ...assemblyRcs.metrics, angleDeg: assemblyRcs.metrics.angleRad * 180 / Math.PI } : rigid?.lastDock;
    const station = rigid?.stationApproach;
    stationButtons.hidden = !station || state.dockingLocked;
    stationClearance.disabled = stationRetreat.disabled = !stationControl();
    stationButtons.querySelector('output').textContent = station ? `Hold point ${[400, 200, 20][station.index] ?? 'cleared'} · ${station.retreating ? 'retreating' : (d?.distanceM?.toFixed(1) ?? '—') + ' m to port'}` : '';
    if (!rcsHud.hidden) rcsHud.textContent = `RCS ${(assemblyRcs?.rcs ?? rigid.rcs).fuelKg.toFixed(2)} kg · mass ${(assemblyRcs?.host ?? rigid.host)?.mass.toFixed(1) ?? '—'} kg`
      + (d ? ` · Port ${d.distanceM.toFixed(2)} m · speed ${d.speedMps.toFixed(2)} m/s · X ${(d.lateralXM ?? 0).toFixed(2)} / Y ${(d.lateralYM ?? 0).toFixed(2)} m · angle ${d.angleDeg.toFixed(1)}° · corridor ${Math.hypot(d.lateralXM ?? 0, d.lateralYM ?? 0) <= .2 ? 'inside' : 'outside'} · ⊕ ${d.inFov ? 'target visible' : 'target offscreen'} · capture ≤0.2 m/s, 0.2 m, 4°, 0.2°/s` : '');
    onDesignTelemetry?.(state.execution || state.lifeSupport ? state : null);
    state.timeline.update();
    timeline.render();
    holdButton.hidden = state.timeline.clock.launched || state.aborted || state.failed;
    holdButton.textContent = state.holding ? 'Resume countdown' : 'Hold';
    holdButton.setAttribute('aria-pressed', String(state.holding));
    if (assemblyRcs) skipManeuverButton.disabled = true;
    document.querySelector('#flight-pause').disabled = skippingStage;
    skipManeuverButton.hidden = false;
    skipManeuverButton.disabled = skippingStage || state.failed || state.aborted || state.complete || restoring;
    skipManeuverButton.textContent = skippingStage ? 'Skipping…' : 'Skip phase';
    skipManeuverButton.title = presentation?.label ?? state.timeline.current?.label ?? state.phase.label;
    const dartTerminal = isDartEncounter(state.kind);
    let altitude = state.altitude;
    if (state.interplanetary?.departed) {
      document.querySelector('#flight-altitude-label').textContent = `Surface altitude · ${bodyNames[state.design.spec.destination]}`;
    } else if (state.id === 'dart' && !['ascent', 'orbit'].includes(state.kind)) {
      altitude = dartTerminal ? dartEncounter.range * .001 : state.solarFlight || state.kind === 'dartRelease' ? state.dartRange * .001
        : state.position.distanceTo(ASTEROID);
      document.querySelector('#flight-altitude-label').textContent = 'To Dimorphos';
    } else if(state.solarFlight && state.kind==='marsTransfer') {
      document.querySelector('#flight-altitude-label').textContent = 'Mars altitude';
    } else if(state.path?.physical){
      document.querySelector('#flight-altitude-label').textContent=`${state.speedReference==='sun-inertial'?'Center distance':'Surface altitude'} · ${state.speedReference==='sun-inertial'?'Sun':bodyNames[state.speedReference?.replace('-relative','')]??'Earth'}`;
    } else if (!['ascent', 'orbit', 'reentry', 'stationApproach', 'docking', 'moonSurface', 'marsSurface'].includes(state.kind)) {
      const nearest = space.bodies.reduce((best, body) => {
        const distance = state.position.distanceTo(body.origin) - body.radius;
        return distance < best.distance ? { distance, name: body.name } : best;
      }, { distance: Infinity, name: 'Earth' });
      altitude = Math.max(0, nearest.distance);
      document.querySelector('#flight-altitude-label').textContent = `Surface altitude · ${nearest.name}`;
    } else document.querySelector('#flight-altitude-label').textContent = 'Altitude';
    altitude *= displayedSpaceScale(state);
    if (shortenedSpaceScale(state) < 1) document.querySelector('#flight-altitude-label').textContent += ' · short route';
    document.querySelector('#flight-altitude').textContent = dartTerminal || state.kind === 'dartRelease'
      ? `${format.format(altitude * 1000)} m` : `${format.format(altitude)} km`;
    document.querySelector('#flight-speed').textContent = `${format.format(state.speed / 1000)} km/s`;
    document.querySelector('#flight-acceleration').textContent = state.interplanetary?.departed||state.path?.physical||['ascent','orbit'].includes(state.kind) ? `${format.format(state.acceleration)} m/s²` : '—';
    document.querySelector('#flight-gforce').textContent = state.interplanetary?.departed||state.path?.physical||['ascent','orbit'].includes(state.kind) ? `${format.format(state.gForce)} g` : '—';
    document.querySelector('#flight-speed').previousElementSibling.textContent=state.interplanetary?.departed ? `Speed · ${bodyNames[state.design.spec.destination]}` : state.path?.physical?`Speed · ${state.speedReference==='sun-inertial'?'Sun':bodyNames[state.speedReference?.replace('-relative','')]??'Earth'}`:'Speed';
    document.querySelector('#flight-fuel').textContent = `${Math.round(state.fuel)} %`;
    const health = state.systems;
    const stats = [
      ['pressure', `${format.format(health.pressure)} kPa`, health.pressure >= 67],
      ['heat', `${Math.round(health.temperature * 100)} %`, health.temperature >= .97],
      ['integrity', `${Math.round(health.integrity * 100)} %`, health.integrity <= .30],
      ['link', health.link ? 'Linked' : 'Signal lost', !health.link],
      ['cabin-pressure', state.crew ? `${format.format(health.cabinPressureKPa)} kPa` : '—', health.cabinPressureKPa < 55],
      ['module-health', Object.keys(health.moduleDamage).length ? Object.keys(health.moduleDamage).join(', ') : 'Nominal', Object.keys(health.moduleDamage).length > 0],
    ];
    for (const [id, text, warning] of stats) {
      const item = document.querySelector(`#flight-${id}`);
      item.textContent = text;
      item.dataset.warning = String(warning);
    }
    const visualPitch = state.kind === 'ascent' ? state.pitch : MathUtils.radToDeg(upAxis.angleTo(forward.copy(upAxis).applyQuaternion(ship.quaternion)));
    journal.update(state, altitude, visualPitch);
    document.querySelector('#flight-angle').textContent = `${Math.round(visualPitch)}° / ${Math.round(state.roll % 360)}°`;
    document.querySelector('#flight-progress').style.width = `${Math.round(state.progress * 100)}%`;
    document.querySelector('#flight-throttle-value').textContent = `${Math.round(state.throttle * 100)} %`;
    throttle.value = String(Math.round(state.throttle * 100));
    const context = controlContext(state, Boolean(presentation));
    const rate = requestedFlightRate();
    const manualInput = state.mode === 'manual' && !inputBlockReason(state, context, rate);
    throttle.disabled = !manualInput || context.owner !== 'launch';
    document.querySelector('#flight-throttle-row').hidden = state.mode !== 'manual' || context.owner !== 'launch';
    panel.querySelector('.flight-inputs').hidden = state.mode !== 'manual' || !['launch', 'trajectory', 'spacecraft', 'lander'].includes(context.owner);
    for (const button of document.querySelectorAll('[data-flight-input]')) button.disabled = !manualInput;
    const navigation = state.navigation.phase === state.phaseIndex ? state.navigation : {
      radial: state.position,
      motion: state.kind === 'orbit' ? surfaceToInertialVelocity(state.launch.positionM, state.launch.velocityMps)
        : context.owner ? state.velocity.clone().multiplyScalar(1000) : new Vector3(),
      acceleration: ['ascent', 'orbit'].includes(state.kind) ? state.launch.accelerationMps2 : state.properAccelerationMps2,
    };
    manualView.update(state, context, rate, {
      ...navigation, attitude: context.actorId === 'columbia' && rigid?.target ? rigid.target.q
        : flightFrame.clone().multiply(assemblyRcs?.host.q ?? ship.quaternion), forwardZ: currentAsset === 'dart',
    }, telemetry);
    dartReplay.hidden = !(dartTerminal && state.complete);
    dartReplay.disabled = Boolean(dartEncounter?.replaying);
    if (state.countdown > 0) {
      banner.textContent = state.preflight > 0 ? 'Preflight' : `T − ${Math.ceil(state.countdown - 1e-8)}`;
      status.textContent = state.paused ? 'Countdown paused' : state.engine
        ? 'Spooling engines' : 'Retracting arms';
    } else {
      banner.textContent = state.complete ? state.mission.history?.ongoing?'Mission segment complete':'Mission complete' : state.failed ? 'Flight aborted'
        : state.totalTime < 1.45 ? 'T + 0 · Liftoff' : presentation?.label ?? state.phase.label;
      status.textContent = state.paused ? 'Flight paused' : state.complete ? 'Objective complete'
        : state.failed ? (state.failureReason === 'structure' ? 'Structural failure' : state.failureReason === 'depressurization' ? 'Cabin depressurization'
          : state.failureReason === 'launch-propellant' ? 'Launch thrust unavailable' : state.interplanetary ? state.failureReason : 'Surface impact')
          : presentation ? presentation.label : state.trimBurn ? 'Trajectory correction burn'
          : state.flightLength === 'short' ? state.solarFlight || state.interplanetary?.departed
            ? 'Short flight · accelerated transfer' : 'Short flight · reduced distances'
          : state.actualRate < Number(warp.value) ? `Maneuver · warp ×${format.format(state.actualRate)}` : 'In progress';
    }
    stopButton.textContent = !state.timeline.clock.launched && !state.aborted ? 'Abort launch' : 'Back to pad';
    if (state.aborted) { banner.textContent = state.timeline.status.state; status.textContent = 'Launch aborted'; }
    else if (state.holding) { banner.textContent = 'HOLD'; status.textContent = 'Countdown on hold'; }
    if (dartTerminal) {
      const aftermath = dartEncounter.aftermath;
      banner.textContent = aftermath ? 'DART · Dimorphos impact' : 'DART · DRACO terminal guidance';
      status.textContent = state.paused ? 'Flight paused' : dartEncounter.replaying ? 'Impact replay · slow motion'
        : aftermath ? state.complete ? 'Impact confirmed' : 'DART signal lost · observing ejecta'
          : 'Autonomous guidance · 6.1 km/s';
      document.querySelector('#flight-speed').textContent = aftermath ? 'Impact at 6.1 km/s' : '6.1 km/s';
      const link = document.querySelector('#flight-link');
      link.textContent = aftermath ? 'Signal lost' : 'Linked';
      link.dataset.warning = String(aftermath);
      const integrity = document.querySelector('#flight-integrity');
      integrity.textContent = aftermath ? '0 %' : '100 %';
      integrity.dataset.warning = String(aftermath);
      if (aftermath) {
        announce('Impact · LICIACube view');
      }
    }
    if (state.complete && state.kind === 'reentry' && !state.lunar) announce('Splashdown · mission complete');
    else if (state.kind === 'reentry' && (state.lunar?.entry?.landed ?? reentryProfile(state.progress).landed) && !state.complete) {
      banner.textContent = 'Splashdown';
      status.textContent = 'Releasing parachutes';
      announce('Capsule stabilizing');
    }
    const stage = document.querySelector('#flight-stage');
    if (state.complete && (state.execution ? state.execution.result(state).status !== 'COMPLETED' : state.timeline.status.state === 'MISSION INCOMPLETE')) {
      banner.textContent = 'MISSION INCOMPLETE';
      status.textContent = 'Flight ended with objectives pending';
    }
    stage.hidden = state.mode !== 'manual' || state.kind !== 'ascent';
    stage.disabled = !manualInput || state.launch.onPad || state.launch.stageIndex >= state.launch.stages.length - 1;
    for (const button of cameraButtons) {
      if (button.dataset.flightCamera === 'cabin') button.textContent = dartTerminal ? 'DRACO' : state.kind === 'moonSurface' ? 'Helmet'
        : state.kind === 'marsSurface' && state.surfaceExpedition ? 'Vehicle camera' : 'Onboard';
      button.disabled = dartTerminal ? !['cabin', 'ship'].includes(button.dataset.flightCamera)
        || button.dataset.flightCamera === 'cabin' && dartEncounter.aftermath
        : !sceneSpace && !['cabin', 'ship'].includes(button.dataset.flightCamera);
      button.setAttribute('aria-pressed', String(button.dataset.flightCamera === cameraId));
    }
    cockpit.textContent = dartTerminal ? 'DRACO · DIMORPHOS · GUIDANCE' : state.kind === 'moonSurface' ? 'HELMET CAMERA' : cabins.name ?? 'ONBOARD CAMERA';
  }
  function checkpoint() {
    const saved = JSON.parse(localStorage.getItem('jugre.flight-save.v1'));
    if (saved?.version !== 1 || !saved.visual) throw new Error('Save not found');
    return saved;
  }
  async function begin(saved = null, trial = null) {
    if (active || loading) return;
    snapshot = launch.snapshotForFlight();
    if (!snapshot) return;
    if (trial) snapshot = { ...snapshot, launcherId: snapshot.id, id: trial, design: null };
    const flightLength = launchFlightLength.value;
    const token = ++runToken;
    loading = true;
    start.disabled = true;
    start.textContent = 'Preparing…';
    try {
      const runtime = await loadPhysX();
      ground.setRuntime(runtime);
      let crew = false;
      snapshot.model.traverse(node => { if (node.userData.role === 'crewCabin') crew = true; });
      const flight = new FlightState(snapshot.id, document.querySelector('#launch-flight-mode').value, {
        crew, vehicle: snapshot.design?.vehicle ?? snapshot.model.userData.launchVehicle, design: snapshot.design, flightLength,
        historicalTraining: document.querySelector('#launch-historical-tasks').checked,
      });
      const { payload, capsule, rover, target } = flight.mission;
      const ids = [...new Set([payload, capsule, rover, target, flight.mission.satelliteModel, flight.mission.probeModel, snapshot.id === 'apollo_11' ? 'eagle' : null, snapshot.id === 'artemis_ii' ? 'icps' : null,
        snapshot.id === 'dart' ? 'liciacube' : null, snapshot.id === 'mars_2020' ? 'ingenuity' : null, rover ? 'mars_parachute' : null].filter(Boolean))];
      const [world, loaded] = await Promise.all([
        space ?? createSpaceWorld(textures),
        Promise.all(ids.map(async (id) => [id, await model(id)])),
        audio.prepare(),
      ]);
      if (token !== runToken) return;
      space = world;
      ground.prepareMission(snapshot.id);
      missionModels = new Map(loaded);
      ground.setModels(missionModels);
      const configuredPayload = snapshot.design?.layout?.find(entry => entry.spacecraft);
      if (configuredPayload && flight.mission.satelliteModel && payloadForFlight) {
        missionModels.set(flight.mission.satelliteModel, payloadForFlight(configuredPayload));
      }
      dartEncounter?.dispose();
      dartEncounter = snapshot.id === 'dart' ? createDartEncounter(missionModels.get('dart'), missionModels.get('didymos')) : undefined;
      if (dartEncounter) flight.dartImpactOrigin.copy(dartEncounter.impactOrigin);
      dartRelease = undefined;
      if (!ascentView) {
        ascentView = createAscentView(space.dayTexture, launch.terrainMaps, space.earthPhotoMaps, space.nightTexture);
      }
      space.reset();
      state = flight;
      if (!saved) state.manualControl.assistance = defaultAssistance;
      state.physicalDockingRequired = true;
      rigid?.dispose();
      rigid = new FlightRigidPhysics(runtime, flightScene, (type, detail) => state.report(type, detail), e => state.systems.impact(state, e));
      cabins.initializePhysics(runtime);
      state.addEventListener('mission', radioEvent);
      state.timeline.addEventListener('mission-control', missionControl);
      journal.bind(state);
      timeline.bind(state.timeline);
      audio.begin();
      clearInput();
      active = true;
      timeline.setVisible(true);
      sceneTools.hidden = false;
      sceneSpace = false;
      lastPadOffset.set(0, 0, 0);
      ascentSmoke.reset();
      departures.reset();
      bridle.visible = false;
      presentation = undefined;
      payloadDeployPending = false;
      cameraMove = undefined;
      trackingCenter=false;coastHolding=false;
      staged = false;
      appliedStages.clear(); nozzleKey = '';
      upperStaged = boostersReleased = false;
      ship.visible = true;
      nearby.scale.setScalar(1);
      nearby.position.set(0, 0, 0);
      seconds = 0;
      lastHud = lastMap = 0;
      bodyView = null;
      cameraId = 'ship';
      cabin = steering = false;
      cockpit.hidden = true;
      controls.enabled = true;
      currentAsset = undefined;
      track = [[FLORIDA.lon, FLORIDA.lat]];
      warp.querySelector('option[value="20000"]')?.remove();
      for (const option of warp.querySelectorAll('[data-interplanetary-warp]')) option.remove();
      if (state.lunar) warp.add(new Option('×20 000 · transfer', '20000'));
      if (state.interplanetary) for (const [value, label] of [[100000, '×100 000 · transfer'], [1000000, '×1 000 000 · transfer'], [1000000000, '×1 billion · outer planets']]) {
        const option = new Option(label, String(value));
        option.dataset.interplanetaryWarp = 'true';
        warp.add(option);
      }
      warp.value = '1';
      syncFlightFormat();
      throttle.value = '100';
      ship.quaternion.identity();
      routeAttitude.identity();
      flightFrame.setFromUnitVectors(upAxis, launchUp);
      ship.position.set(0, 0, 0);
      nearby.clear();
      surfaceHardware.clear();
      if (state.sceneSurfaceTrial) {
        sceneSpace = true; showShip(state.id);
      } else replaceVisual(snapshot.model.clone(true));
      ascentOriginHeight = launch.mountHeight + halfHeight;
      document.querySelector('#flight-pause').textContent = 'Pause';
      document.querySelector('#flight-pause').setAttribute('aria-pressed', 'false');
      onStart(state.mission.title);
      guideClimb = defaultTracking;
      controls.enablePan = false;
      controls.minPolarAngle = .06;
      controls.maxPolarAngle = Math.PI - .06;
      controls.minDistance = Math.max(4, halfHeight * 1.45);
      controls.maxDistance = Math.max(110, halfHeight * 9);
      controls.target.set(0, launch.mountHeight + halfHeight * .93, 0);
      camera.position.copy(controls.target).add(climbOffset(0, previousClimbOffset));
      controls.update();
      if (state.sceneSurfaceTrial) { guideClimb = false; frameShip(13); }
      panel.hidden = false;
      banner.hidden = false;
      document.querySelector('#flight-title').textContent = state.mission.title;
      document.querySelector('#flight-destination').textContent = state.mission.destination;
      launch.prepareFlight();
      updatePadOffset();
      mixAudio();
      if (!state.sceneSurfaceTrial) state.report('preflight', { prepSeconds: PREIGNITION_SECONDS }, 'preflight');
      phaseChanged();
      simulationHardware();
      telemetry();
      updateMap();
      if (saved && !restoreCheckpoint(saved)) {
        const reason = eventText.textContent || 'Flight restoration failed.';
        stop();
        throw new Error(reason);
      }
    } catch (error) {
      console.error(error);
      document.querySelector('#launch-status').textContent = `Flight setup failed · ${error.message}`;
    } finally {
      loading = false;
      start.disabled = false;
      start.textContent = 'Launch ↗';
      start.blur();
    }
  }
  start.addEventListener('click', () => begin());
  document.querySelector('#design-resume').addEventListener('click', async () => {
    if (active || loading) return;
    try {
      const saved = checkpoint();
      const restored = FlightState.fromSave(saved.state);
      if (!restored.design) throw new Error('No saved custom flight');
      await launch.selectDesign({ ...restored.design, vehicle: restored.launch.vehicle });
      if (launch.snapshotForFlight()?.design?.spec.id !== restored.design.spec.id) throw new Error('Saved rocket unavailable');
      await begin(saved);
    } catch (error) {
      document.querySelector('#launch-status').textContent = error.message;
    }
  });
  const stop = () => {
    runToken++;
    settleCountdown();
    active = false;
    assemblyRcs?.dispose(); assemblyRcs = null;
    dragonRetreat = null;
    rigid?.dispose(); rigid = undefined;
    cabins.disposePhysics();
    dartEncounter?.dispose();
    dartEncounter = undefined;
    dartRelease = undefined;
    dartReplay.hidden = true;
    if (!state.aborted && (!state.timeline.clock.launched || state.execution && !state.complete && !state.failed)) state.abort();
    else audio.reset();
    state.removeEventListener('mission', radioEvent);
    state.timeline.removeEventListener('mission-control', missionControl);
    timeline.setVisible(false);
    controls.enabled = true;
    cockpit.hidden = true;
    clearInput();
    panel.hidden = banner.hidden = sceneTools.hidden = true;
    journal.close();
    cameraMenu.open = false;
    eventText.textContent = '';
    launch.restoreFlight();
    onStop();
  };
  stopButton.addEventListener('click', () => {
    if (!state.timeline.clock.launched && !state.aborted) { settleCountdown(); state.abort(); telemetry(); return; }
    stop();
  });
  holdButton.addEventListener('click', () => { settleCountdown(); state.hold(); telemetry(); });
  function restoreCheckpoint(saved) {
    if (!active || restoring) return;
    try {
      if (saved.state.missionId !== snapshot.id) throw new Error('Select the saved mission on the pad');
      const restored = FlightState.fromSave(saved.state);
      if (snapshot.design && (restored.design.spec.id !== snapshot.design.spec.id
        || JSON.stringify(restored.design.layout) !== JSON.stringify(snapshot.design.layout)
        || restored.design.carrier !== (snapshot.design.carrier ?? null))) throw new Error('Select the saved vehicle and mission');
      restoring = true;
      state.removeEventListener('mission', radioEvent);
      state.timeline.removeEventListener('mission-control', missionControl);
      audio.reset();
      departures.reset();
      nearby.clear(); surfaceHardware.clear();
      bridle.visible = false;
      presentation = undefined;
      payloadDeployPending = false;
      // Rebuild hardware using the same separation and deployment operations.
      // A disposable state keeps reconstruction out of flight history and radio.
      state = new FlightState(snapshot.id, 'command', { crew: restored.crew,
        design: restored.design ? { ...restored.design, satellite: restored.satellite?.serialize(), lunar: restored.lunar, interplanetary: restored.interplanetary } : null,
        vehicle: restored.launch.vehicle });
      state.timeline.muted = true;
      state.countdown = 0;
      state.altitude = 200;
      staged = upperStaged = boostersReleased = false;
      appliedStages.clear(); nozzleKey = ''; ascentSmoke.reset();
      nearbyType = undefined;
      currentAsset = undefined;
      replaceVisual(snapshot.model.clone(true));
      if (restored.execution) {
        state.launch = restored.launch;
        syncLaunchHardware();
        if (state.launch.vehicle.fairingMassKg > 0 && !state.launch.fairingAttached) {
          for (const id of fairingParts) findPart(visual, id)?.removeFromParent();
        }
      } else {
        if (saved.visual.boostersReleased) separateBoosters();
        if (saved.visual.staged) stageRocket();
        if (saved.visual.upperStaged) stageRocket();
      }
      const finishPresentation = () => {
        if (!presentation) return;
        const action = presentation;
        action.pose(1);
        action.finish();
        presentation = undefined;
      };
      for (let i = 1; i <= restored.phaseIndex; i++) {
        state.phaseIndex = i;
        state.progress = 1;
        phaseChanged();
        finishPresentation();
        if (payloadDeployPending && (i < restored.phaseIndex || restored.timeline.events.find(e => e.id === 'payload')?.status === 'COMPLETE')) {
          payloadDeployPending = false; deployPayload(); finishPresentation();
        }
      }
      // Restore Mars EDL hardware already detached before the checkpoint.
      if (restored.kind === 'marsLanding') {
        if (restored.reported.has('marsParachute')) {
          const shell = findPart(visual, 'mars_backshell');
          if (shell) { const chute = missionModels.get('mars_parachute').clone(true); chute.position.y = 2.22; shell.add(chute); }
        }
        if (restored.altitude < 8) findPart(visual, 'mars_heatshield')?.removeFromParent();
        if (restored.altitude < 3) findPart(visual, 'mars_backshell')?.removeFromParent();
      }
      // Reconstruction replays past separations. Their transient debris must
      // not reappear around the current lander when loading a checkpoint.
      departures.reset();
      state = restored;
      stageCheckpoint = saved.stageStart?.state?.missionId === restored.id ? saved.stageStart
        : { version: 1, state: restored.serialize(), rigid: saved.rigid ?? null, interior: saved.interior ?? null,
          visual: saved.visual, assemblyRcs: saved.assemblyRcs };
      state.physicalDockingRequired = true;
      cabins.resetPhysics();
      diagnostics.lastDraw = 0;
      if (state.kind === 'ascent') syncLaunchHardware();
      state.addEventListener('mission', radioEvent);
      state.timeline.addEventListener('mission-control', missionControl);
      journal.bind(state);
      timeline.bind(state.timeline);
      timeline.setVisible(true);
      sceneTools.hidden = false;
      seconds = state.totalTime;
      recoverySeconds = saved.visual.recoverySeconds ?? 0;
      lastHud = lastMap = seconds;
      presentation = undefined;
      payloadDeployPending = state.id === 'apollo_11' && state.kind === 'moonTransfer' && !state.reported.has('apolloTransposition');
      clearInput();
      syncFlightFormat();
      bodyView = null; cabin = false; cameraId = 'ship';
      cockpit.hidden = true;
      cameraMove = undefined;
      sceneSpace = state.kind !== 'ascent' || state.altitude >= PAD_HANDOFF_KM;
      trackingCenter=false;coastHolding=false;
      if (sceneSpace) { camera.near = .025; camera.far = 6000; camera.updateProjectionMatrix(); }
      updateFlightFrame(100);
      updateShipAttitude(100);
      rigid.setFrame(flightFrame);
      rigid.syncHost(visual, ship, state);
      rigid.restore(saved.rigid, nearby);
      if (coastHolding && saved.rigid?.host) {
        coastAttitude.copy(rigid.host.q);
        routeAttitude.copy(inverseFrame).multiply(coastAttitude);
        ship.quaternion.copy(routeAttitude);
      }
      if (saved.assemblyRcs) {
        assemblyRcs?.dispose();
        assemblyRcs = new AssemblyRcs(rigid.runtime, findPart(visual, 'columbia_csm'), findPart(visual, 'eagle_lm'), (type, detail) => state.report(type, detail), saved.assemblyRcs);
        state.assemblyActive = true; present('Columbia / Eagle manual docking', Infinity, () => {}, () => {});
      }
      if(state.kind==='separate' && !rigid.freeModule) rigid.detachNearby(nearby,nearby.children[0],departureVector(1.8,1.2,0));
      cabins.restorePhysics(saved.interior);
      if (sceneSpace) frameShip();
      else {
        updatePadOffset(); lastPadOffset.copy(padOffset);
        controls.target.copy(padOffset).addScaledVector(upAxis, ascentOriginHeight);
        camera.position.copy(controls.target).add(climbOffset(state.altitude, previousClimbOffset));
        controls.update();
      }
      audio.begin();
      audio.pause(state.paused);
      document.querySelector('#flight-pause').textContent = state.paused ? 'Resume' : 'Pause';
      document.querySelector('#flight-pause').setAttribute('aria-pressed', String(state.paused));
      telemetry(); updateMap();
      announce('Flight restored');
      return true;
    } catch (error) { announce(`Load failed · ${error.message}`); return false; }
    finally { restoring = false; }
  }
  function toggleControl() {
    if (!active) return false;
    const next = state.mode === 'manual' ? 'command' : 'manual';
    const attitude = flightFrame.clone().multiply(ship.quaternion);
    const rate = requestedFlightRate();
    if (!state.setMode(next, { attitude, presentation: Boolean(presentation), rate })) return false;
    if (state.kind !== 'ascent') {
      routeAttitude.copy(ship.quaternion);
      coastHolding = false;
    }
    clearInput();
    flightViewport.focus({ preventScroll: true });
    telemetry();
    return true;
  }
  function canRailFlight() {
    if (assemblyRcs || dragonRetreat || state.surfaceExpedition && ['moonSurface', 'marsSurface'].includes(state.kind)) return false;
    return !cabin && (state.lunar?.isolated ? rigid.canRailExpedition() : rigid.canRail());
  }
  function requestedFlightRate() {
    return state.flightLength === 'short' ? 1 : Number(warp.value) || 1;
  }
  warp.addEventListener('change', () => { clearInput(); warp.blur(); telemetry(); });
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) clearInput();
  });
  throttle.addEventListener('input', () => { if (!throttle.disabled) throttleTarget = Number(throttle.value) / 100; });
  document.querySelector('#flight-stage').addEventListener('click', () => { stageRequested = true; });
  dartReplay.addEventListener('click', () => {
    if (!active || !state.complete || !dartEncounter) return;
    if (state.paused) document.querySelector('#flight-pause').click();
    cabin = false;
    cameraId = 'ship';
    cockpit.hidden = true;
    dartEncounter.replay();
    dartEncounter.update(state, 0, false);
    telemetry();
  });
  document.querySelector('#flight-pause').addEventListener('click', (event) => {
    settleCountdown();
    state.paused = !state.paused;
    clearInput();
    audio.pause(state.paused);
    event.currentTarget.textContent = state.paused ? 'Resume' : 'Pause';
    event.currentTarget.setAttribute('aria-pressed', String(state.paused));
    telemetry();
  });
  mapToggle.addEventListener('click', (event) => {
    globeMap = !globeMap;
    event.currentTarget.textContent = globeMap ? 'Florida' : 'World map';
    updateMap();
  });
  function focusBody(name) {
    bodyView = name;
    cameraMove = undefined;
    camera.position.copy(space.sunDirection).multiplyScalar(name === 'Saturn' ? 150 : 85);
    camera.position.y += name === 'Saturn' ? 40 : 0;
    controls.minDistance = 38; controls.maxDistance = 220;
    controls.target.set(0, 0, 0);
    controls.update();
  }
  for (const button of cameraButtons) {
    button.addEventListener('click', () => {
      cameraMenu.open = false;
      const id = button.dataset.flightCamera;
      cameraId = id;
      cabin = id === 'cabin';
      cameraMove = undefined;
      cockpit.hidden = !cabin;
      if (isDartEncounter(state.kind)) {
        controls.enabled = false;
        dartEncounter.update(state, 0, cabin);
        telemetry();
        return;
      }
      controls.enabled = !cabin;
      if (cabin) {
        bodyView = null;
        guideClimb = false;
        cabins.centerView();
        aimCabin();
      } else if (id === 'ship') {
        bodyView = null;
        guideClimb = false;
        if (sceneSpace) frameShip();
        else {
          controls.target.copy(findVesselCenter());
          camera.position.copy(controls.target).add(climbOffset(state.altitude, previousClimbOffset));
          controls.update();
        }
      }
      else {
        focusBody(id === 'earth' ? 'Earth' : 'Moon');
      }
      mixAudio();
      telemetry();
      updateMap();
    });
  }
  document.querySelector('#flight-journal-open').addEventListener('click', () => journal.open());
  for (const metric of panel.querySelectorAll('[data-chart]')) {
    metric.addEventListener('click', () => journal.open(metric.dataset.chart));
    metric.addEventListener('keydown', event => {
      if (!metric.matches('button') && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        journal.open(metric.dataset.chart);
      }
    });
  }
  window.addEventListener('keydown', event => {
    if (!active || event.code !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable=true]')) return;
    if (event.target.closest?.('dialog') && !journalDialog.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (journalDialog.open) journal.close(); else journal.open();
  }, true);
  const textInput = 'dialog, select, textarea, input:not([type=range]), [contenteditable]:not([contenteditable=false])';
  window.addEventListener('keydown', event => {
    if (!active || event.defaultPrevented || event.target.closest?.(textInput) || event.altKey || event.metaKey) return;
    if (event.ctrlKey && !event.code.startsWith('Control')) return;
    if (event.target.matches?.('input[type=range]') && event.code.startsWith('Arrow')) return;
    const action = flightInput.matchKey(controlContext(state, Boolean(presentation)), event.code);
    if (!action || action === 'nextActor' && event.target !== flightViewport) return;
    if (event.target.closest?.('button, summary') && ['Space', 'Enter'].includes(event.code)) return;
    if (action === 'nextActor') {
      // A sole available vessel should not trap normal keyboard focus.
      if (!event.repeat && state.mode === 'manual' && state.surfaceExpedition) {
        event.preventDefault(); clearInput();
        const a = state.surfaceExpedition.switchActor(); announce(a.id); telemetry();
      } else if (!event.repeat && state.mode === 'manual') announce('One controllable vehicle available.');
      return;
    }
    event.preventDefault();
    flightInput.keyDown(event.code, event.repeat);
  });
  window.addEventListener('keyup', event => flightInput.keys.delete(event.code));
  window.addEventListener('blur', clearInput);
  document.addEventListener('focusin', event => { if (event.target.closest?.(textInput)) clearInput(); });
  viewport.addEventListener('pointerdown', () => { if (active) flightViewport.focus({ preventScroll: true }); });
  viewport.addEventListener('pointermove', event => {
    if (!active || !cabin || state.kind !== 'marsSurface' || !state.surfaceExpedition || !(event.buttons & 1)) return;
    const expedition = state.surfaceExpedition;
    expedition.mastYaw -= event.movementX * .005;
    expedition.mastPitch = MathUtils.clamp(expedition.mastPitch - event.movementY * .005, -1.2, 1.2);
    aimCabin();
  });
  const touchActions = { up: 'pitchUp', down: 'pitchDown', left: 'rollLeft', right: 'rollRight' };
  for (const button of document.querySelectorAll('[data-flight-input]')) {
    button.addEventListener('pointerdown', (event) => {
      if (button.disabled) return;
      event.preventDefault();
      flightInput.pointers.set(event.pointerId, touchActions[button.dataset.flightInput]);
      button.setPointerCapture(event.pointerId);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, e => flightInput.pointers.delete(e.pointerId));
  }
  return {
    start: begin,
    bindings,
    setPreferences(settings) {
      defaultAssistance = settings.assistance;
      defaultTracking = settings.tracking;

    },
    hasCheckpoint() {
      try { const saved = checkpoint(); FlightState.fromSave(saved.state); return true; } catch { return false; }
    },
    async resumeCheckpoint() {
      const saved = checkpoint();
      const restored = FlightState.fromSave(saved.state);
      const trial = ['barkhan_4', 'barkhan_6'].includes(saved.state.missionId) ? saved.state.missionId : null;
      if (restored.design) {
        await launch.selectDesign({ ...restored.design, vehicle: restored.launch.vehicle });
      } else {
        // The rover range does not display its launcher; a known vehicle is
        // sufficient to initialize the shared flight scene for legacy saves.
        const rocketId = trial ? 'apollo_11' : saved.state.missionId;
        const layout = rocketId === 'custom' ? (saved.visual.customLayout ?? getCustomLayout?.()) : null;
        if (rocketId === 'custom' && !layout?.length) throw new Error('Saved rocket assembly is unavailable.');
        await launch.selectRocket(rocketId, layout);
        const actual = launch.snapshotForFlight();
        if (!trial && rocketId === 'custom' && JSON.stringify(actual?.model?.userData?.launchVehicle) !== JSON.stringify(restored.launch.vehicle)) {
          throw new Error('The saved rocket does not match the current assembly.');
        }
      }
      if (!launch.snapshotForFlight()) throw new Error('Saved vehicle could not be prepared.');
      await begin(saved, trial);
      if (!active) throw new Error(document.querySelector('#launch-status').textContent || 'Flight could not be restored.');
    },
    get active() { return active; },
    update(dt) {
      if (!active || document.hidden && state.flightLength === 'short') return;
      diagnostics.update();
      const shortFlight = state.flightLength === 'short';
      const requestedRate = requestedFlightRate();
      const context = controlContext(state, Boolean(presentation));
      const focus = document.activeElement;
      const gamepad = document.hasFocus() && !focus?.closest?.(textInput + ', #flight-bindings')
        ? connectedGamepad(navigator) : null;
      let input = flightInput.sample(context, gamepad);
      input.presentation = Boolean(presentation);
      if (stageRequested) input.actions.add('stage');
      input.throttleTarget = throttleTarget;
      stageRequested = false;
      throttleTarget = undefined;
      if (input.actions.has('pause')) {
        document.querySelector('#flight-pause').click();
        input = undefined;
      } else if (input.actions.has('takeover') && toggleControl()) {
        input = undefined;
      }
      const moving = Boolean(input && state.mode === 'manual' && !inputBlockReason(state, context, requestedRate)
        && (input.axes.pitch || input.axes.yaw || input.axes.roll));
      const wasComplete = state.complete;
      const wasFailed = state.failed;
      const beforeTime=state.totalTime;
      const wasPresenting=Boolean(presentation);
      const total = skippingStage || presentation&&!state.realTimeLunar ? 0
        : state.update(dt, input, requestedRate, () => phaseChanged() && !shortFlight, simulationHardware, canRailFlight);
      if (payloadDeployPending && state.timeline.events.find(e => e.id === 'tli')?.status === 'COMPLETE' && state.time>=LUNAR_TIMING[state.id].tliBurn+LUNAR_TIMING[state.id].extractionDelay && !presentation) {
        payloadDeployPending = false;
        deployPayload();
      }
      if (state.id === 'artemis_ii' && state.objectivesEnabled && state.kind === 'orbit' && state.historicalOperations.flags.icpsBurnDone && !presentation && !nearbyType) {
        deployPayload(); nearbyType = 'icps'; nearbyModel('icps');
      }
      if (!state.paused && !state.aborted && !state.failed) {
        if (presentation) {
          if(!state.realTimeLunar)seconds += state.advancePresentation(dt);
          presentation.time += state.realTimeLunar?(wasPresenting?state.totalTime-beforeTime:0):dt;
          const p = Math.min(1, presentation.time / presentation.duration);
          if (assemblyRcs) assemblyRcs.render(); else presentation.pose(p);
          if(!state.realTimeLunar)simulationHardware(state, dt);
          if (p === 1 || assemblyRcs?.complete) {
            presentation.finish();
            if (assemblyRcs) endAssembly();
            presentation = undefined;
            announce(state.phase.label);
          }
        }
      }
      if (moving && !steering && cabin && state.crew && state.mode === 'manual' && total > 0 && state.countdown === 0) {
        audio.fx('suit', 'cabin', .7);
      }
      steering = moving;
      seconds += total;
      if (isDartEncounter(state.kind)) {
        dartEncounter.update(state, dt, cabin);
        if (state.objectivesEnabled && state.kind === 'dartAftermath' && !state.paused && !state.complete && state.mode === 'command'
          && !cubeControls.matches(':focus-within')) {
          const count = state.historicalOperations.dart.cubeFrames.length;
          if (count < 3 && state.progress >= [.482, .5, .518][count]) takeCubeFrame(count, 0);
        }
        if (dartEncounter.aftermath) { cabin = false; cameraId = 'ship'; cockpit.hidden = true; }
        audio.mix({ cabin: false, distance: 0, engine: 0, pressure: 0, pan: 0, density: 0 });
        telemetry();
        updateMap();
        return;
      }
      if (state.kind === 'dartRelease') {
        dartRelease(state.progress);
        const cube = findPart(visual, 'liciacube');
        if (cube && cube.position.z > .5) state.report('liciacubeReleased', { separationM: cube.position.z }, 'liciacubeReleased');
      }
      recoverySeconds += state.paused ? 0 : dt;
      updateFlightFrame(state.paused ? 0 : dt);
      const wasSpace = sceneSpace;
      sceneSpace ||= state.kind !== 'ascent' || state.altitude >= PAD_HANDOFF_KM;
      if (!wasSpace && sceneSpace) {
        controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
        controls.minPolarAngle = 0.02; controls.maxPolarAngle = Math.PI - 0.02;
        controls.enablePan = false;
        camera.near = 0.025; camera.far = 6000;
        camera.updateProjectionMatrix();
        padCenter.copy(lastPadOffset).addScaledVector(upAxis, ascentOriginHeight);
        padToFlight.copy(inverseFrame).multiply(padFrame);
        camera.position.sub(padCenter).applyQuaternion(padToFlight);
        controls.target.sub(padCenter).applyQuaternion(padToFlight);
        camera.quaternion.premultiply(padToFlight);
        controls.update();
      }
      if (!sceneSpace) {
        const altitude = state.altitude * 1000;
        updatePadOffset();
        padMotion.copy(padOffset).sub(lastPadOffset);
        lastPadOffset.copy(padOffset);
        camera.position.add(padMotion);
        controls.target.add(padMotion);
        guideLaunchCamera(state.altitude);
        desiredForward.copy(state.launch.thrustDirection).applyQuaternion(padFrame.clone().invert());
        const padAttitude = turn.setFromUnitVectors(upAxis, desiredForward).clone().multiply(manualAttitude.setFromAxisAngle(upAxis, MathUtils.degToRad(state.roll)));
        launch.flightPose(padOffset.y, state.pitch, state.enginePower, seconds, padOffset.x, padOffset.z, state.yaw, padAttitude);
        controls.update();
      } else {
        launch.flightBackdrop(seconds);
        if (state.kind === 'ascent' && guideClimb && !staged && !bodyView) {
          guideLaunchCamera(state.altitude);
          controls.update();
        }
        rigid.setFrame(flightFrame);
        if (assemblyRcs) assemblyRcs.render(); else rigid.render(ship);
        renderMarsEdl();
        if (nearbyType === 'icps' && !presentation && nearby.children.length) {
          if (!rigid.proximity) rigid.startProximity(nearby.children[0]);
          rigid.renderProximity(nearby);
        }
        else if (nearbyType === 'iss' && nearby.children.length) {
          const p = MathUtils.smoothstep(state.progress, 0, state.kind === 'docking' ? .82 : 1);
          nearby.position.set(0, 0, 0);
          nearby.quaternion.copy(ship.quaternion).multiply(upsideDown);
          const offset = state.objectivesEnabled && state.id === 'iss_resupply' ? new Vector3(0, 420, 0)
            : state.kind === 'docking' ? new Vector3(0, 68 * (1 - p), 0)
              : new Vector3(78 * (1 - p), 68 + 252 * (1 - p), 35 * (1 - p));
          alignDockingPorts(nearby, visual, offset.clone().applyQuaternion(ship.quaternion));
          if (!state.paused && !state.aborted && !state.failed) {
            const localOffset = offset.clone().applyQuaternion(ship.quaternion.clone().invert());
            if (state.kind === 'stationApproach' && Math.abs(localOffset.x) < 1 && Math.abs(localOffset.z) < 1) state.report('stationAlignment', {}, 'stationAlignment');
            if (state.kind === 'docking' && offset.length() <= 70) state.report('stationApproach', {}, 'stationApproach');
            if (state.kind === 'docking' && offset.length() <= 20 && !state.dockingHoldDone && !presentation) {
              state.dockingHoldDone = true;
              state.report('dockingHold', {}, 'dockingHold');
              present('Approach checkpoint', 1.5, () => {}, () => state.report('finalApproach', {}, 'finalApproach'));
            }
          }
          rigid.approach(nearby.children[0], nearby, state.kind, state.paused ? 0 : dt);
        }
        else if (nearbyType === 'columbia') {
          const approachProgress = state.localAscent && state.localAscent.status !== 'orbit' ? 0 : state.progress;
          positionColumbia(nearby, visual, approachProgress);
          if (nearby.visible && nearby.children.length) rigid.approach(nearby.children[0], nearby, state.kind, state.paused ? 0 : dt);
        }
        else if (!rigid.freeModule) nearby.position.set(0, 0, 0);
        const engine = state.trimBurn ? 0 : state.enginePower;
        const lunarEngine = landerKinds.has(state.kind);
        const vacuum = state.kind === 'ascent' ? MathUtils.smoothstep(state.altitude, 12, 90) : 1;
        ascentOrigin.copy(state.position).addScaledVector(climbUp, ascentOriginHeight * .001);
        exhaust.emitterWorld(emitter);
        emitter.applyQuaternion(flightFrame).multiplyScalar(.001).add(ascentOrigin);
        if (state.kind === 'ascent') ascentSmoke.update(state.totalTime, engine > .01 && state.altitude < 60, emitter, ascentOrigin, inverseFrame);
        else ascentSmoke.root.visible = false;
        exhaust.update(seconds, engine, lunarEngine ? 0.65 : Math.max(0.6, width * 0.6),
          lunarEngine ? 5 : Math.max(6, halfHeight * 1.1), vacuum);
        surfaceHardware.visible = state.kind === 'rendezvous' && state.altitude < 2;
        surfaceHardware.position.y = -state.altitude * 1000;
        const step = ground.update(state, state.kind === 'rendezvous' ? -surfaceGroundY : halfHeight, recoverySeconds);
        const lunarView = state.kind === 'moonSurface' ? 'eva'
          : state.kind === 'moonLanding' && state.altitude <= 2 ? 'landing' : null;
        if (lunarView !== lunarSurfaceCamera) {
          lunarSurfaceCamera = lunarView;
          if (lunarView && !cabin && !bodyView) {
            const center = lunarView === 'eva' ? ground.explorer.getWorldPosition(new Vector3()).add(new Vector3(0, 1.2, 0))
              : new Box3().setFromObject(visual, true).getCenter(new Vector3());
            cameraMove = undefined;
            controls.target.copy(center);
            camera.position.copy(center).add(new Vector3(1, .45, 1.5).normalize().multiplyScalar(lunarView === 'eva' ? 18 : 28));
            controls.minDistance = 2.5; controls.maxDistance = 120;
            controls.minPolarAngle = .15; controls.maxPolarAngle = Math.PI / 2 - .03;
            trackedCenter.copy(center); trackingCenter = true;
            controls.update();
          } else if (!lunarView) {
            controls.minPolarAngle = .02; controls.maxPolarAngle = Math.PI - .02;
          }
        }
        visual.visible = !(state.surfaceExpedition && state.kind === 'marsSurface');
        if (state.kind === 'moonSurface' && ground.explorer.visible) state.report('eva', {}, 'eva');
        if (step && cabin && state.kind === 'moonSurface' && !state.paused) {
          audio.fx('step', 'cabin', .66);
          audio.fx('suit', 'cabin', .24);
        }
        recovery.update(state, ship, halfHeight, width, recoverySeconds, state.paused ? 0 : dt,
          bodyView || cabin ? null : camera, bodyView || cabin ? null : controls);
      }
      if(sceneSpace&&!cabin&&!bodyView&&visual){
        const center = state.mode === 'manual' && controlContext(state).actorId === 'columbia' && nearby.visible
          ? new Box3().setFromObject(nearby, true).getCenter(new Vector3())
          : state.surfaceExpedition && ['moonSurface', 'marsSurface'].includes(state.kind)
          ? ground.group.localToWorld(state.surfaceExpedition.current.p.clone())
          : state.kind === 'moonSurface' ? ground.explorer.getWorldPosition(new Vector3()).add(new Vector3(0, 1.2, 0))
          : new Box3().setFromObject(visual,true).getCenter(new Vector3());
        if(trackingCenter&&(!cameraMove||cameraMove.follow)){
          const change=center.clone().sub(trackedCenter);camera.position.add(change);controls.target.add(change);
        }
        trackedCenter.copy(center);trackingCenter=true;
      }else trackingCenter=false;
      if (cameraMove && (!state.paused || lunarSurfaceCamera) && !cabin && !bodyView) {
        cameraMove.time += dt;
        const p = MathUtils.smoothstep(cameraMove.time, 0, 1.65);
        if(cameraMove.follow){
          camera.position.lerpVectors(cameraMove.from,cameraMove.position,p).add(trackedCenter);
          controls.target.copy(cameraMove.look).multiplyScalar(1-p).add(trackedCenter);
        }else{
          camera.position.lerpVectors(cameraMove.from,cameraMove.position,p);
          controls.target.lerpVectors(cameraMove.look,cameraMove.center,p);
        }
        controls.update();
        if (p === 1) cameraMove = undefined;
      }
      aimCabin();
      if (!state.paused) cabins.update(dt);
      mixAudio();
      if (!wasComplete && state.complete && state.lunar?.entry?.landed) announce('Splashdown · mission complete');
      hudAge += dt;
      mapAge += dt;
      if ((shortFlight ? hudAge >= .1 || state.paused : seconds - lastHud > 0.1 || state.paused)
        || !wasComplete && state.complete || !wasFailed && state.failed) {
        telemetry(); lastHud = seconds; hudAge = 0;
      }
      if (shortFlight ? mapAge >= .4 : seconds - lastMap > .4) {
        updateMap(); lastMap = seconds; mapAge = 0;
      }
    },
    render(renderer) {
      if (!active) return false;
      if (isDartEncounter(state.kind)) {
        dartEncounter.render(renderer, camera.aspect);
        return true;
      }
      if (!sceneSpace) {
        if (cabin) {
          launch.renderBackground(renderer, camera);
          if (cabins.name) {
            renderer.autoClear = false;
            renderer.clearDepth();
            renderer.render(cabins.scene, camera);
            renderer.autoClear = previousAutoClear;
          }
        }
        return cabin;
      }
      camera.updateMatrixWorld();
      space.update(state, camera, bodyView, flightFrame);
      if(earthBackdropBlend()<1)space.renderClouds(renderer);
      // Keep the curved local landscape in the frustum throughout approach.
      // A modest near plane preserves depth precision for the lander and gravel.
      const surfaceView = !bodyView && ground.blend > 0;
      const far = surfaceView ? 180000 : 6000;
      const near = surfaceView ? .1 : .025;
      if (camera.far !== far || camera.near !== near) {
        camera.far = far; camera.near = near; camera.updateProjectionMatrix();
      }
      const climb = !bodyView && (state.kind === 'ascent' || state.kind === 'orbit');
      const earthBlend = earthBackdropBlend();
      let backdropOpacity = 1;
      if (climb) {
        backdropOpacity = MathUtils.smoothstep(state.altitude, PAD_HANDOFF_KM, PAD_FADE_END_KM);
      }
      if(earthBlend>0) {
        ascentView.update(state,camera,flightFrame,space.sunDirection,ascentOriginHeight,earthBlend*backdropOpacity);
        ascentView.renderClouds(renderer);
      }
      if (recovery.active) sun.position.set(-35, 55, 75);
      else {
        sun.position.copy(space.sunDirection).applyQuaternion(inverseFrame).multiplyScalar(90);
        if (surfaceView && state.kind.startsWith('mars')) {
          sun.position.lerp(new Vector3(-57, 40, 58).normalize().multiplyScalar(90), ground.blend);
        }
      }
      ambient.intensity = climb ? MathUtils.lerp(1.5, .7, MathUtils.smoothstep(state.altitude, 4, 130))
        : recovery.active ? 1.35 : MathUtils.lerp(.7, state.kind.startsWith('mars') ? .85 : .24, surfaceView ? ground.blend : 0);
      if (surfaceView) ground.prepareRender(camera, frameRotation, space, sun.position.clone().normalize());
      renderer.autoClear = false;
      renderer.clear();
      if (climb && backdropOpacity < 1) {
        padBackgroundCamera.copy(camera, false);
        updatePadOffset();
        padCenter.copy(padOffset).addScaledVector(upAxis, ascentOriginHeight);
        flightToPad.copy(padFrame).invert().multiply(flightFrame);
        padBackgroundCamera.position.applyQuaternion(flightToPad).add(padCenter);
        padBackgroundCamera.quaternion.premultiply(flightToPad);
        padBackgroundCamera.near = 0.8;
        padBackgroundCamera.far = 65000;
        padBackgroundCamera.updateProjectionMatrix();
        launch.renderBackground(renderer, padBackgroundCamera);
      }
      if (earthBlend<1 && (!recovery.active || recovery.skyBlend < 1 || bodyView)) renderer.render(space.scene, space.camera);
      if (earthBlend>0) renderer.render(ascentView.scene, camera);
      if (!bodyView) {
        if (recovery.active) {
          recovery.renderClouds(renderer,camera);
          renderer.render(recovery.background,camera);
        }
        if (ground.blend > 0) renderer.render(ground.background, camera);
        renderer.clearDepth();
        const cameraHost = state.kind === 'moonSurface' ? ground.explorer : ship;
        const visible = cameraHost.visible;
        if (cabin) cameraHost.visible = false;
        try { renderer.render(flightScene, camera); }
        finally { cameraHost.visible = visible; }
        if (cabin && cabins.name) {
          renderer.clearDepth();
          renderer.render(cabins.scene, camera);
        }
      }
      renderer.autoClear = previousAutoClear;
      return true;
    },
  };
}
