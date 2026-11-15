import { Euler, Quaternion, Vector3, MathUtils } from 'three';
import { terrainHeight, noise, roverTrialRocks, surfaceRocks } from './planet-terrain.mjs';
import { targetInFov } from './spacecraft-control.mjs';
import { roverRoute } from './rover-route.mjs';

export const surfaceConfig = {
  educational: true, evaSeconds: 9000, lunarGravity: 1.62, marsGravity: 3.71,
  easep: { educational: true, sunAzimuth: .8, earthAzimuth: -1.2, alignmentDeg: 15, levelDeg: 5 },
  rover: { perseverance: { massKg: 1025, maxMps: .8, generatorW: 110, capacityJ: 2500000, tubes: 43 },
    curiosity: { massKg: 899, maxMps: .8, generatorW: 110, capacityJ: 2500000, tubes: 0 },
    barkhan_4: { massKg: 185, maxMps: 6 / 3.6, solarW: 160, capacityJ: 2.4 * 3.6e6, tubes: 0, wheels: 4 },
    barkhan_6: { massKg: 540, maxMps: 4.2 / 3.6, solarW: 220, capacityJ: 9.6 * 3.6e6, tubes: 18, wheels: 6 } },
  helicopter: { massKg: 1.8, rho: .01225, coefficient: .026, maxRpm: 2900,
    capacityJ: 70000, flightW: 350, heaterW: .8, linkM: 500 },
};
const actor = (id, profile, p) => ({ id, profile, p: new Vector3(...p), v: new Vector3(), yaw: 0, remainingS: 9000,
  tool: 1, fallen: false, energyJ: profile === 'helicopter' ? 70000 : 2500000, temperature: 20,
  wear: 0, slip: 0, distanceM: 0, rpm: 0, status: 'ready', hover: false, landing: false, plan: [], inventory: [] });
const item = (id, title, x, z, tool, kind = 'equipment', massKg = 0) => ({ id, title, p: [x, 0, z], tool, kind, massKg, progress: 0, done: false });
export function evaObjects() {
  return [item('ladder', 'Лестница / первый шаг', 7, 3, 0), item('contingency', 'Аварийный образец', 8, 4, 1, 'sample', .5),
    item('flag', 'Флаг · древко и штанга', 11, 6, 6), item('seismometer', 'Сейсмометр · уровень / панели на Солнце', 13, 4, 4),
    item('reflector', 'Отражатель · направление на Землю', 13, 8, 4), item('foil', 'Экран солнечного ветра', 10, 9, 4),
    item('plaque', 'Табличка', 6, 2, 0), item('tv', 'Телекамера на модуль', 9, 7, 5),
    ...Array.from({ length: 6 }, (_, i) => item(`sample${i}`, i % 2 ? 'Брекчия' : 'Базальт', 12 + i * 2, 10 + i % 2 * 3, 2, 'sample', 4)),
    item('core0', 'Керн 1', 10, 12, 3, 'sample', .6), item('core1', 'Керн 2', 8, 12, 3, 'sample', .6),
    item('memorial', 'Мемориальный пакет', 6, 10, 4), item('lm', 'Лебёдка / возврат в модуль', 6, 3, 0),
    ...['Панорама', 'След ботинка', 'Aldrin', 'Модуль: север', 'Модуль: юг', 'Модуль: восток', 'Модуль: запад'].map((title, i) => item(`photo${i}`, title, 5 + i, 15, 5, 'photo'))];
}
export function roverObjects() {
  return [item('checkpoint', 'Контрольная точка / возврат к базе', 12, 0, 0, 'waypoint'),
    ...['Базальт', 'Осадочная порода', 'Брекчия', 'Коронация', 'Джон Кляйн', 'Rocknest'].map((title, i) => item(`rock${i}`, title, 10 + i * 7, 7 + i % 2 * 4, 3, 'rock', .02)),
    item('depot', 'Три вилки · линия пробирок', 6, -3, 0, 'depot'),
    item('conglomerate', 'Конгломерат', 16, 18, 1, 'photo'),
    item('sharp', 'Подножие горы Шарп', 35, 16, 0, 'waypoint'),
    item('craneDebris', 'Обломки спускаемой ступени', 40, 10, 1, 'photo')];
}
export function helicopterLift(rpm, rho = surfaceConfig.helicopter.rho) { return surfaceConfig.helicopter.coefficient * rho * (rpm * 2 * Math.PI / 60) ** 2; }
export class SurfaceExpedition {
  constructor(id, saved = null) {
    this.id = id; this.body = id === 'apollo_11' ? 'moon' : /^barkhan/.test(id) ? 'earth' : 'mars';
    this.actors = id === 'apollo_11' ? [actor('armstrong', 'astronaut', [7, 0, 3]), actor('aldrin', 'astronaut', [6, 0, 4])]
      : [actor(id === 'mars_science_laboratory' ? 'curiosity' : /^barkhan/.test(id) ? id : 'perseverance', 'rover', [0, 0, 0]),
        ...(id === 'mars_2020' ? [actor('ingenuity', 'helicopter', [3, 0, 0])] : [])];
    this.active = 0; this.elapsed = 0; this.objects = id === 'apollo_11' ? evaObjects() : roverObjects();
    this.sampleKg = 0; this.loadedKg = 0; this.queue = []; this.commandDelayS = 8;
    if (this.body === 'earth') this.actors[0].energyJ = surfaceConfig.rover[id].capacityJ;
    this.returned = false; this.photos = []; this.deposited = []; this.analyses = []; this.solarHour = 14;
    this.firstTrip = false; this.nightEnergyJ = 0;
    this.ingenuityDeployed = false; this.nightComplete = false;
    this.operations = { stage: 0, route: [], routeKey: null };
    this.mastYaw = 0; this.mastPitch = 0; this.autonav = null; this.targetId = null;
    if (saved) this.restore(saved);
  }
  get current() { return this.actors[this.active]; }
  height(x, z) { return this.body === 'earth' ? 0 : terrainHeight(this.body, x, z, this.id === 'mars_science_laboratory' ? 1 : 0); }
  slope(p) { return Math.atan(Math.hypot(this.height(p.x + .4, p.z) - this.height(p.x - .4, p.z), this.height(p.x, p.z + .4) - this.height(p.x, p.z - .4)) / .8); }
  switchActor() { this.active = (this.active + 1) % this.actors.length; return this.current; }
  nearest() { const a = this.current; return this.objects.find(o => o.id === this.targetId) ?? this.objects.filter(o => !o.done || ['lm', 'depot', 'foil'].includes(o.id)).sort((a1, b) => a.p.distanceTo(new Vector3(...a1.p)) - a.p.distanceTo(new Vector3(...b.p)))[0]; }
  aimAt(o) {
    const p = this.current.p, mast = this.current.profile === 'rover' ? 1.55 : .18;
    this.mastYaw = Math.atan2(o.p[0] - p.x, o.p[2] - p.z);
    this.mastPitch = Math.atan2(o.p[1] - p.y - mast, Math.hypot(o.p[0] - p.x, o.p[2] - p.z));
  }
  photo(o, emit) {
    const a = this.current, isEva = a.profile === 'astronaut';
    const q = new Quaternion().setFromEuler(new Euler(isEva ? 0 : -this.mastPitch, isEva ? a.yaw : this.mastYaw, 0, 'YXZ'));
    const origin = a.p.clone().add(new Vector3(0, isEva ? 0 : a.profile === 'rover' ? 1.55 : .18, 0));
    if (!targetInFov(origin, q, new Vector3(...o.p), 25, new Vector3(0, 0, 1))) return false;
    if (!this.photos.includes(o.id)) this.photos.push(o.id);
    o.done = o.kind === 'photo' || o.done; emit('surfacePhoto', { target: o.id, count: this.photos.length, image: true, actor: a.id }); return true;
  }
  interact(emit = () => {}) {
    const a = this.current, o = this.nearest(); if (!o || a.status === 'failed') return false;
    if (a.profile === 'astronaut' && a.tool === 5 && o.id !== 'tv' || a.profile === 'helicopter' || a.profile === 'rover' && a.tool === 1) return this.photo(o, emit);
    const distance = a.p.distanceTo(new Vector3(...o.p)); if (distance > 2.5) return false;
    if (a.profile === 'astronaut') {
      if (a.fallen) { a.fallen = false; return true; }
      if (o.id === 'lm') {
        this.loadedKg += this.sampleKg; this.sampleKg = 0; this.returned = this.loadedKg >= 20;
        emit('samplesLoaded', { massKg: this.loadedKg, ascentMassKg: 4700 + this.loadedKg });
        if (this.returned) emit('evaReturned', { massKg: this.loadedKg, remainingS: a.remainingS }); return true;
      }
      if (o.tool && a.tool !== o.tool || o.done && o.id !== 'foil') return false;
      if (['seismometer', 'reflector'].includes(o.id)) {
        const desired = o.id === 'seismometer' ? surfaceConfig.easep.sunAzimuth : surfaceConfig.easep.earthAzimuth;
        if (Math.abs(Math.atan2(Math.sin(a.yaw - desired), Math.cos(a.yaw - desired))) > surfaceConfig.easep.alignmentDeg * Math.PI / 180
          || this.slope(a.p) > surfaceConfig.easep.levelDeg * Math.PI / 180) return false;
      }
      if (o.id === 'foil' && o.done) { emit('foilRecovered', { recovered: true }); o.recovered = true; return true; }
      o.progress++; if (o.progress < (o.id === 'flag' ? 4 : o.id.startsWith('core') ? 3 : 1)) return true;
      o.done = true;
      if (o.kind === 'sample') { this.sampleKg += o.massKg; a.inventory.push(o.id); emit('sampleCollected', { id: o.id, type: o.title, massKg: o.massKg, totalKg: this.sampleKg + this.loadedKg }); }
      else emit('equipmentInstalled', { id: o.id, levelled: true, aligned: true }); return true;
    }
    if (a.profile === 'rover') {
      const c = surfaceConfig.rover[a.id];
      const cost = [0, 3000, 5000, 18000, 7000, 12000, 18000][a.tool];
      if (a.energyJ < cost) return false;
      a.energyJ -= cost;
      if (o.kind === 'waypoint') { o.done = true; emit('roverWaypoint', { id: o.id, distanceM: a.distanceM, wear: a.wear }); return true; }
      if (o.kind === 'depot') {
        const tube = a.inventory.find(x => x.sealed); if (!tube) return false;
        const p = a.p.toArray();
        if (Math.hypot(p[0] - o.p[0], p[2] - o.p[2]) > .6 || this.deposited.some(d => new Vector3(...d.p).distanceTo(a.p) < 1)) return false;
        a.inventory.splice(a.inventory.indexOf(tube), 1); this.deposited.push({ ...tube, p });
        o.p = [6 - this.deposited.length * 1.4, 0, -3];
        emit('tubeDeposited', { count: this.deposited.length, spaced: true }); return true;
      }
      if (a.tool === 2) { if (!this.analyses.includes(o.id)) this.analyses.push(o.id); emit('laserAnalysis', { target: o.id, count: this.analyses.length }); }
      if (a.tool === 3) {
        o.progress++; if (o.progress === 1) { emit('rockGround', { target: o.id }); return true; }
        const used = this.deposited.length + a.inventory.filter(x => x.sealed).length;
        if (c.tubes && used >= c.tubes) return false;
        const sample = { id: `${o.id}:${used}`, rock: o.title, massKg: .02, sealed: Boolean(c.tubes) };
        a.inventory.push(sample); emit('rockDrilled', { ...sample, types: new Set(a.inventory.map(x => x.rock)).size });
      }
      if (a.tool === 4) { a.inventory.push({ id: 'sand', rock: 'sand', massKg: .05, sieved: true }); emit('sandScooped', { massKg: .05, sieved: true }); }
      if ([5, 6].includes(a.tool) && a.inventory.length) {
        const sample = a.inventory.at(-1), instrument = a.tool === 5 ? 'CheMin' : 'SAM';
        sample.analyses ??= [];
        if (!sample.analyses.includes(instrument)) sample.analyses.push(instrument);
        emit('laboratoryAnalysis', { instrument, sample: sample.rock, data: true });
        const sand = a.inventory.some(s => s.rock === 'sand' && s.sieved && s.analyses?.includes('CheMin'));
        const powder = a.inventory.some(s => s.rock === 'Джон Кляйн' && s.analyses?.includes('CheMin') && s.analyses.includes('SAM'));
        if (a.id === 'curiosity' && sand && powder) emit('habitabilityDiscovery', { sand, powder, minerals: 2 });
      }
      return true;
    }
    return false;
  }
  deployHelicopter(emit) {
    const rover = this.actors.find(a => a.id === 'perseverance'), helicopter = this.actors.find(a => a.id === 'ingenuity');
    if (!rover || !helicopter || this.ingenuityDeployed || rover.v.length() > .05) return false;
    helicopter.p.copy(rover.p).add(new Vector3(2.5, 0, 0)); helicopter.p.y = this.height(helicopter.p.x, helicopter.p.z);
    this.ingenuityDeployed = true; emit('helicopterDeployed', { distanceM: helicopter.p.distanceTo(rover.p), deployed: true }); return true;
  }
  waitForDawn(emit) {
    const rover = this.actors[0], helicopter = this.actors[1], c = surfaceConfig.helicopter;
    if (!this.ingenuityDeployed || this.nightComplete || !helicopter || helicopter.status === 'flying' || rover.v.length() > .05
      || this.queue.length || this.autonav || rover.p.distanceTo(helicopter.p) < 5) return 0;
    const phase = this.solarHour, nightHours = phase < 6 ? 6 - phase : phase >= 18 ? 30 - phase : 12;
    const daylightHours = phase >= 6 && phase < 18 ? 18 - phase : 0;
    const nightS = nightHours * 88775 / 24, daylightS = daylightHours * 88775 / 24;
    helicopter.energyJ = Math.max(0, Math.min(c.capacityJ, helicopter.energyJ + daylightS * 12) - nightS * c.heaterW);
    this.nightEnergyJ += nightS * c.heaterW;
    const elapsed = nightS + daylightS;
    rover.energyJ = Math.min(surfaceConfig.rover[rover.id].capacityJ, rover.energyJ + 50 * elapsed);
    this.elapsed += elapsed; this.solarHour = 6; this.nightComplete = helicopter.energyJ > 0;
    if (this.nightComplete) emit('firstNightHeated', { energyJ: this.nightEnergyJ, reserveJ: helicopter.energyJ });
    else { helicopter.status = 'failed'; emit('helicopterNightFailure', { batteryJ: 0 }); }
    return elapsed;
  }
  roverExperiment(action, emit) {
    const a = this.current;
    if (a.id !== 'perseverance') return false;
    const cost = action === 'moxie' ? 120000 : 3000;
    if (a.energyJ < cost) return false;
    a.energyJ -= cost;
    if (action === 'moxie') emit('moxieProduced', { energyJ: cost, oxygenG: 2, educational: true });
    else emit('marsMicrophone', { energyJ: cost, recording: true });
    return true;
  }
  enqueue(axes, durationS = 2) {
    if (this.queue.length >= 64 || !Number.isFinite(durationS) || durationS <= 0 || durationS > 120) return false;
    this.queue.push({ actor: this.current.id, executeS: this.elapsed + this.commandDelayS, durationS, axes: { ...axes } }); return true;
  }
  autopilot(dt, emit) {
    const a = this.current;
    if (this.body === 'mars') { this.marsAutopilot(dt, emit); return; }
    if (a.profile !== 'astronaut' || this.returned) { this.advance(dt, {}, new Set(), 'standard', emit); return; }
    const next = this.objects.find(o => !o.done && o.id !== 'lm') ?? this.objects.find(o => o.id === 'lm');
    this.targetId = next.id; const delta = new Vector3(...next.p).sub(a.p); delta.y = 0;
    if (delta.length() > 1.5) this.advance(dt, { lateral: delta.x / delta.length(), longitudinal: delta.z / delta.length() }, new Set(), 'standard', emit);
    else {
      a.tool = next.tool || 1; a.yaw = Math.atan2(delta.x, delta.z);
      if (next.id === 'seismometer') a.yaw = surfaceConfig.easep.sunAzimuth;
      if (next.id === 'reflector') a.yaw = surfaceConfig.easep.earthAzimuth;
      this.advance(dt, {}, new Set(), 'standard', emit); this.interact(emit);
    }
  }
  marsAutopilot(dt, emit) {
    const rover = this.actors[0], stage = this.operations;
    this.active = 0;
    const navigate = goal => {
      const k = goal.join(',');
      if (stage.routeKey !== k) {
        stage.routeKey = k;
        stage.route = roverRoute(rover.p, goal, (x, z) => this.roverBlocked(x, z, 1.15));
      }
      while (stage.route.length && Math.hypot(rover.p.x - stage.route[0][0], rover.p.z - stage.route[0][1]) < .65) stage.route.shift();
      const [x, z] = stage.route[0] ?? [goal[0], goal[2]];
      this.autonav = [x, this.height(x, z), z];
    };
    const visit = (id, tool) => {
      const target = this.objects.find(o => o.id === id);
      if (!target) return false;
      this.targetId = id; rover.tool = tool;
      if (rover.p.distanceTo(new Vector3(...target.p)) <= 2.3 && rover.v.length() <= .1) {
        this.autonav = null; return this.interact(emit);
      }
      if (rover.p.distanceTo(new Vector3(...target.p)) > 2.3) navigate([target.p[0], 0, target.p[2]]);
      else this.autonav = null;
      return false;
    };
    if (rover.id === 'curiosity') {
      const program = [['rock3', 2], ['rock5', 4], ['rock5', 5], ['rock4', 3], ['rock4', 3], ['rock4', 5], ['rock4', 6]];
      const goal = program[stage.stage];
      if (goal && visit(...goal)) stage.stage++;
      if (stage.stage >= program.length && !this.returned) {
        this.returned = true;
      }
    } else if (rover.id === 'perseverance') {
      if (stage.stage === 0) {
        if (this.firstTrip) { stage.stage++; this.autonav = null; }
        else navigate(this.objects.find(o => o.id === 'checkpoint').done ? [0, 0, 0] : [12, 0, 0]);
      } else if (stage.stage <= 10) {
        if (rover.inventory.length >= stage.stage) stage.stage++;
        else visit('rock' + (stage.stage - 1) % 3, 3);
      } else if (stage.stage === 11) {
        const depot = this.objects.find(o => o.id === 'depot');
        this.targetId = 'depot'; navigate(depot.p);
        if (Math.hypot(rover.p.x - depot.p[0], rover.p.z - depot.p[2]) <= .55 && this.interact(emit) && this.deposited.length >= 10) { stage.stage++; this.autonav = null; }
      } else if (stage.stage === 12) {
        if (rover.v.length() < .05 && this.deployHelicopter(emit)) stage.stage++;
      } else {
        const h = this.actors[1];
        if (stage.stage === 13) {
          const x = h.p.x + 9;
          navigate([x, 0, h.p.z]);
          if (rover.p.distanceTo(h.p) >= 8) { stage.stage++; this.autonav = null; }
        }
        if (stage.stage === 14 && this.nightComplete) {
          this.active = 1;
          if (h.status !== 'flying' && !stage.flightStarted) h.status = 'ready';
          const climb = MathUtils.clamp((3 - (h.p.y - this.height(h.p.x, h.p.z))) * .75, -.5, 1);
          if (h.hoverSeconds >= 30) h.landing = true;
          this.advance(dt, { climb: stage.flightStarted && h.landing ? 0 : climb }, new Set(), 'standard', emit);
          stage.flightStarted ||= h.status === 'flying';
          if (h.status === 'landed' && h.hoverSeconds >= 30) this.returned = true;
          return;
        }
      }
    }
    this.advance(dt, {}, new Set(), 'standard', emit);
  }
  roverBlocked(x, z, margin = .9) {
    const terrain = this.id === 'mars_science_laboratory' ? 1 : 0;
    const rocks = this.body === 'earth' ? roverTrialRocks : surfaceRocks(terrain);
    return this.slope(new Vector3(x, 0, z)) > .4 || rocks
      .some(r => r.radius > .2 && Math.hypot(r.x - x, r.z - z) < r.radius + margin);
  }
  planFlight(points) {
    if (points.length > 32 || points.some(p => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite) || p[1] < 0 || p[1] > 20)) return false;
    const h = this.actors.find(a => a.profile === 'helicopter');
    if (!h || !this.ingenuityDeployed || h.energyJ < 7000 || this.actors[0].p.distanceTo(h.p) < 5) return false;
    h.plan = points.map(p => [...p]); h.status = 'flying'; h.hover = true; h.landing = false; return true;
  }
  advance(dt, axes = {}, actions = new Set(), assistance = 'standard', emit = () => {}) {
    if (actions.has('nextActor')) this.switchActor();
    for (let i = 1; i <= 6; i++) if (actions.has('tool' + i)) this.current.tool = i;
    if (actions.has('interact')) this.interact(emit);
    if (actions.has('drop')) {
      const a = this.current; if (a.profile === 'astronaut') {
        const sample = this.objects.find(o => o.id === a.inventory.at(-1));
        if (sample) { a.inventory.pop(); this.sampleKg = Math.max(0, this.sampleKg - sample.massKg); sample.p = a.p.toArray(); sample.done = false; sample.progress = 0; }
      }
      else if (a.profile === 'rover') this.interact(emit);
    }
    if (actions.has('hoverLand') && this.current.status === 'flying') { this.current.hover = true; this.current.landing = true; }
    if (actions.has('jump') && !this.current.fallen && this.current.p.y <= this.height(this.current.p.x, this.current.p.z) + .02) this.current.v.y = 1.3;
    while (dt > 1e-8) {
      const step = Math.min(.02, dt); dt -= step; this.elapsed += step; this.solarHour = (14 + this.elapsed / 88775 * 24) % 24;
      for (const a of this.actors) {
        let command = a === this.current ? axes : {};
        if (assistance === 'realism' && a.profile === 'rover') {
          command = {}; const queued = this.queue.find(q => q.actor === a.id && q.executeS <= this.elapsed && q.executeS + q.durationS > this.elapsed);
          if (queued) command = queued.axes;
        }
        if (a.profile === 'astronaut') this.walk(a, command, step, emit);
        if (a.profile === 'rover') this.drive(a, command, step, actions.has('brake'), emit);
        if (a.profile === 'helicopter') this.fly(a, command, step, assistance, emit);
      }
      this.queue = this.queue.filter(q => q.executeS + q.durationS > this.elapsed);
    }
  }
  walk(a, axes, dt, emit) {
    if (this.returned || a.status === 'failed') return;
    a.remainingS = Math.max(0, a.remainingS - dt);
    if (!a.remainingS) { a.status = 'failed'; emit('evaResourceExpired', { actor: a.id, educational: true }); return; }
    const desired = new Vector3(axes.lateral ?? 0, 0, axes.longitudinal ?? 0).clampLength(0, 1).multiplyScalar(a.fallen ? 0 : .7);
    a.v.x = MathUtils.damp(a.v.x, desired.x, 2, dt); a.v.z = MathUtils.damp(a.v.z, desired.z, 2, dt);
    if (desired.lengthSq()) a.yaw = Math.atan2(desired.x, desired.z);
    a.v.y -= surfaceConfig.lunarGravity * dt; a.p.addScaledVector(a.v, dt);
    const h = this.height(a.p.x, a.p.z); if (a.p.y < h) { a.p.y = h; a.v.y = 0; }
    if (this.slope(a.p) > .6 && !a.fallen) { a.fallen = true; emit('astronautFall', { actor: a.id }); }
  }
  drive(a, axes, dt, brake, emit) {
    a.driveCommand = axes.drive ?? 0; a.steerCommand = axes.steer ?? 0; a.spinCommand = axes.spin ?? 0; a.braking = brake;
    const c = surfaceConfig.rover[a.id], slope = this.slope(a.p), sun = Math.max(0, Math.sin((this.solarHour - 6) / 12 * Math.PI));
    a.energyJ = MathUtils.clamp(a.energyJ + ((c.generatorW ?? c.solarW * sun) - 60 - Math.abs(axes.drive ?? 0) * 180) * dt, 0, c.capacityJ);
    if (a.status === 'failed' || a.energyJ <= 0) return;
    const sand = noise(a.p.x / 8 + 19, a.p.z / 8) > .6;
    a.slip = sand ? .55 : .05;
    let speed = (axes.drive ?? 0) * c.maxMps * (1 - a.slip);
    if (brake) speed = 0;
    if (this.autonav && a === this.current) {
      const goal = new Vector3(...this.autonav), delta = goal.sub(a.p); speed = Math.min(c.maxMps, delta.length());
      const desiredYaw = Math.atan2(delta.x, delta.z);
      if (a.nativeVehicle) {
        const error = Math.atan2(Math.sin(desiredYaw - a.yaw), Math.cos(desiredYaw - a.yaw));
        a.spinCommand = MathUtils.clamp(error * 3, -1, 1);
        if (Math.abs(error) > .3) speed = 0;
      } else a.yaw = desiredYaw;
      if (delta.length() < .5) { this.autonav = null; speed = 0; a.spinCommand = 0; emit('autonavArrived', { position: a.p.toArray() }); }
      const ahead = a.p.clone().add(new Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)).multiplyScalar(Math.min(1.3, delta.length())));
      if (this.roverBlocked(ahead.x, ahead.z)) { speed = 0; this.autonav = null; emit('autonavObstacle', { position: ahead.toArray() }); }
    }
    a.yaw += ((axes.steer ?? 0) * Math.abs(speed) * .6 + (axes.spin ?? 0) * .3) * dt;
    a.driveCommand = speed / c.maxMps;
    const desired = new Vector3(Math.sin(a.yaw) * speed, 0, Math.cos(a.yaw) * speed);
    if (!a.nativeVehicle) { a.v.lerp(desired, 1 - Math.exp(-(brake ? 20 : 3) * dt)); a.p.addScaledVector(a.v, dt); a.p.y = this.height(a.p.x, a.p.z); }
    a.distanceM += a.v.length() * dt;
    a.tilt = slope; if (a.id === 'curiosity' && slope > .12) a.wear += a.v.length() * dt * .0005;
    if (slope > .65 || a.wear >= 1) { a.status = 'failed'; emit('roverFailure', { reason: slope > .65 ? 'rollover' : 'wheel wear', tiltRad: slope, wear: a.wear }); }
    const checkpoint = this.objects.find(o => o.id === 'checkpoint');
    if (checkpoint && !checkpoint.done && a.p.distanceTo(new Vector3(...checkpoint.p)) < 2) { checkpoint.done = true; emit('roverWaypoint', { id: 'checkpoint', position: a.p.toArray() }); }
    if (checkpoint?.done && !this.firstTrip && Math.hypot(a.p.x, a.p.z) < 2 && a.distanceM > 10) {
      this.firstTrip = true; emit('roverReturned', { distanceM: a.distanceM });
      if (this.body === 'earth') this.returned = true;
    }
  }
  fly(a, axes, dt, assistance, emit) {
    const c = surfaceConfig.helicopter, ground = this.height(a.p.x, a.p.z), altitude = a.p.y - ground;
    const rover = this.actors.find(b => b.profile === 'rover');
    const linked = rover && a.p.distanceTo(rover.p) <= c.linkM && Array.from({ length: 15 }, (_, i) => (i + 1) / 16).every(t => {
      const p = a.p.clone().lerp(rover.p.clone().add(new Vector3(0, 1.5, 0)), t); return p.y + .3 >= this.height(p.x, p.z);
    });
    if (!linked && a.status === 'flying' && !a.linkLost) { a.linkLost = true; a.landing = true; emit('helicopterLinkLost', { rangeM: rover ? a.p.distanceTo(rover.p) : null }); }
    a.link = linked;
    const night = this.solarHour < 6 || this.solarHour > 18;
    a.energyJ = Math.max(0, a.energyJ - (a.status === 'flying' ? c.flightW : night ? c.heaterW : -12) * dt);
    a.energyJ = Math.min(c.capacityJ, a.energyJ);
    if (night && this.ingenuityDeployed) this.nightEnergyJ += c.heaterW * dt;
    if (!night && this.nightEnergyJ >= c.heaterW * 43000 && !this.nightComplete && a.energyJ > 0) {
      this.nightComplete = true; emit('firstNightHeated', { energyJ: this.nightEnergyJ, reserveJ: a.energyJ });
    }
    if (a.status !== 'flying' && assistance !== 'realism' && axes.climb > 0 && linked && a.energyJ >= 7000 && this.ingenuityDeployed && rover.p.distanceTo(a.p) > 5) {
      a.status = 'flying'; a.hover = true; a.landing = false; a.airborne = false; a.home = a.p.toArray(); a.hoverSeconds = 0;
      a.maxAltitudeM = 0; a.maxRangeM = 0; a.emergency = false; a.linkLost = false;
    }
    if (a.status !== 'flying') { a.temperature = MathUtils.damp(a.temperature, 10, .02, dt); return; }
    a.temperature += ((a.rpm / 2400) ** 2 * .3 - (a.temperature - 10) * .003) * dt;
    if ((a.energyJ < 7000 || a.temperature > 85) && !a.emergency) { a.emergency = true; a.landing = true; emit('helicopterEmergency', { batteryJ: a.energyJ, temperatureC: a.temperature }); }
    let climb = a.landing ? -.5 : (axes.climb ?? 0), horizontal = new Vector3(axes.lateral ?? 0, 0, axes.longitudinal ?? 0).multiplyScalar(2);
    if (assistance === 'realism' || a.plan.length) {
      const p = a.plan[0]; if (p) {
        const delta = new Vector3(...p).sub(a.p); climb = MathUtils.clamp(delta.y, -1, 1); horizontal.copy(delta).setY(0).clampLength(0, 2);
        if (delta.length() < .3) a.plan.shift();
      } else { climb = -.5; a.landing = true; }
    }
    const targetAccel = surfaceConfig.marsGravity + (climb - a.v.y) * 3;
    const targetRpm = Math.sqrt(Math.max(0, c.massKg * targetAccel / (c.coefficient * c.rho))) * 60 / (2 * Math.PI);
    a.rpm = MathUtils.damp(a.rpm, a.energyJ > 0 ? Math.min(c.maxRpm, targetRpm) : 0, 7, dt);
    a.v.y += (helicopterLift(a.rpm) / c.massKg - surfaceConfig.marsGravity) * dt;
    a.v.x = MathUtils.damp(a.v.x, horizontal.x, 1.5, dt); a.v.z = MathUtils.damp(a.v.z, horizontal.z, 1.5, dt);
    a.yaw += (axes.yaw ?? 0) * dt;
    a.p.addScaledVector(a.v, dt); a.dust = Math.max(0, 1 - altitude / 2) * a.rpm / c.maxRpm;
    a.navDriftM = (a.navDriftM ?? 0) + (noise(a.p.x / 7, a.p.z / 7) > .6 ? .025 : .001) * dt;
    if (altitude > .15 && !a.airborne) { a.airborne = true; emit('helicopterLiftoff', { altitudeM: altitude }); }
    a.maxAltitudeM = Math.max(a.maxAltitudeM ?? 0, altitude);
    a.maxRangeM = Math.max(a.maxRangeM ?? 0, a.home ? Math.hypot(a.p.x - a.home[0], a.p.z - a.home[2]) : 0);
    if (Math.abs(altitude - 3) < .3 && a.v.length() < .3) a.hoverSeconds = (a.hoverSeconds ?? 0) + dt;
    if (a.p.y <= ground && !a.airborne && !a.landing && a.energyJ > 0) { a.p.y = ground; a.v.y = 0; return; }
    if (a.p.y <= ground) {
      const verticalMps = Math.abs(a.v.y); a.p.y = ground; a.v.set(0, 0, 0); a.rpm = 0;
      a.status = verticalMps <= 1 ? 'landed' : 'failed';
      emit('helicopterLanded', { verticalMps, hoverSeconds: a.hoverSeconds ?? 0, batteryJ: a.energyJ, emergency: Boolean(a.emergency),
        position: a.p.toArray(), maxAltitudeM: a.maxAltitudeM, maxRangeM: a.maxRangeM, home: a.home });
    }
  }
  serialize() {
    return { version: 1, id: this.id, actors: this.actors.map(a => ({ ...a, nativeVehicle: false, p: a.p.toArray(), v: a.v.toArray() })),
      values: Object.fromEntries(Object.entries(this).filter(([k, v]) => k !== 'actors' && (v == null || typeof v !== 'function'))) };
  }
  restore(s) {
    if (s.version !== 1 || s.id !== this.id || !Array.isArray(s.actors) || s.actors.length !== this.actors.length) throw new Error('Invalid expedition state');
    this.actors = s.actors.map((a, i) => {
      if (a.id !== this.actors[i].id || ![...a.p, ...a.v, a.energyJ, a.remainingS].every(Number.isFinite) || a.energyJ < 0) throw new Error('Invalid expedition vehicle');
      return { ...a, p: new Vector3(...a.p), v: new Vector3(...a.v) };
    });
    for (const [k, v] of Object.entries(s.values ?? {})) if (Object.hasOwn(this, k) && !['actors', 'id', 'body'].includes(k)) this[k] = structuredClone(v);
    if (!Number.isInteger(this.active) || this.active < 0 || this.active >= this.actors.length) throw new Error('Invalid active vehicle');
  }
}
