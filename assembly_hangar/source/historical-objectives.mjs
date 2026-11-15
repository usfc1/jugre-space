import { historicalCatalog } from './historical-objective-catalog.mjs';

// Signals originate in controllers, contacts, instruments and resource models.
// No objective is completed by elapsed time or the name of a scheduled phase.
const signalRules = {
  '1-1-1': 'orbitMeasured', '1-1-2': 'qWithinLimit', '1-1-3': 'manualOrbitMeasured',
  '1-2-1': 'tliBurn', '1-2-2': 'eagleExtracted', '1-2-3': 'rcsBudget', '1-3-1': 'lunarOrbitMeasured', '1-3-2': 'burnWindow',
  '1-4-1': 'descentBurn', '1-4-2': 'computerDecision', '1-4-3': 'landerTouchdown', '1-4-4': 'contactShutdown',
  '1-4-5': 'landingReserve', '1-4-6': 'landingAccuracy', '1-4-7': 'landingGold',
  '1-5-1': 'equipmentInstalled:ladder', '1-5-2': 'sampleCollected:contingency', '1-5-3': 'equipmentInstalled:tv',
  '1-5-4': 'equipmentInstalled:flag', '1-5-5': 'equipmentInstalled:plaque', '1-5-6': ['equipmentInstalled:seismometer', 'equipmentInstalled:reflector'],
  '1-5-7': 'foilRecovered', '1-5-8': 'sampleMass', '1-5-9': ['sampleCollected:core0', 'sampleCollected:core1'],
  '1-5-10': 'evaPhotos', '1-5-11': 'equipmentInstalled:memorial', '1-5-12': 'evaReturned',
  '1-6-1': 'lunarAscentBurn', '1-6-2': 'flagFell', '1-6-3': 'columbiaCaptured', '1-6-4': 'crewAndSamplesTransferred', '1-6-5': 'sextantEagle',
  '1-7-1': 'teiBurn', '1-7-2': 'correctionBudget', '1-7-3': ['serviceSeparated', 'entryCorridor'], '1-7-4': 'splash', '1-7-5': 'quarantineTransferred',
  '2-1-1': 'orbitMeasured', '2-1-2': 'highEllipseMeasured', '2-2-1': 'icpsCircuit', '2-2-2': 'icpsHold', '2-2-3': 'rcsBudget',
  '2-3-1': 'co2Exercise', '2-3-2': 'navigationChecked', '2-3-3': 'lifeSupportRestored', '2-4-1': 'tliBurn', '2-4-2': 'preciseTliBurn',
  '2-5-1': 'lunarBlackout', '2-5-2': 'farsidePhotos', '2-5-3': 'earthrisePhoto', '2-6-1': 'courseCorrection',
  '2-6-2': ['serviceSeparated', 'entryCorridor', 'parachutes'], '2-6-3': 'splash',
  '3-1-1': ['orbitMeasured', 'centaurDeparture'], '3-2-1': 'marsEntryWindow', '3-2-2': 'correctionBudget',
  '3-3-1': ['cruiseSeparated', 'marsEntry'], '3-3-2': 'entryBankRange', '3-3-3': 'rangeTrigger', '3-3-4': 'heatshieldSeparated',
  '3-3-5': 'safeSiteSelected', '3-3-6': ['backshellSeparated', 'poweredDescent'], '3-3-7': ['skyCraneTouchdown', 'tethersCut', 'craneFlyaway'],
  '3-4-1': 'roverReturned', '3-4-2': 'threeRockTypes', '3-4-3': 'fiveLaserTargets', '3-4-4': 'marsMicrophone', '3-4-5': 'moxieProduced',
  '3-4-6': 'tubeDepotTen', '3-4-7': 'delayedRoute', '3-5-1': ['helicopterDeployed', 'firstNightHeated'], '3-5-2': 'firstHelicopterFlight',
  '3-5-3': 'helicopterLateral', '3-5-4': 'helicopterFiftyReturn', '3-5-5': 'helicopterThreePhotos', '3-5-6': 'helicopterNewAirfield', '3-5-7': 'helicopterDebrisPhoto',
  '4-1-1': 'entryBankRange', '4-4-1': 'laserAnalysis:rock3', '4-4-2': 'conglomeratePhoto', '4-4-3': ['sandScooped', 'cheminSand'],
  '4-4-4': ['johnKleinDrilled', 'cheminPowder', 'samPowder'], '4-4-5': 'habitabilityDiscovery', '4-4-6': 'sharpTraverse',
  '5-2-1': 'rosaDeployed', '5-2-2': 'nextBurn', '5-3-1': 'liciacubeReleased', '5-4-1': 'dimorphosSelected', '5-4-2': 'dartCorrections',
  '5-4-3': 'dimorphosImpact', '5-4-4': 'dartFifty', '5-4-5': 'dartGold', '5-4-6': 'lastDracoFrame', '5-5-1': 'cubeThreeFrames', '5-5-2': 'cubeTailFrame',
  '6-1-1': 'centaurDeparture', '6-1-2': 'voyagerBooms', '6-1-3': 'antennaEarth', '6-2-1': 'jupiterBPlane', '6-2-2': 'hydrazineReserve',
  '6-2-3': 'goldenRecordRead', '6-3-1': 'jupiterImages', '6-3-2': 'tapeDownlinked', '6-3-3': 'saturnCorridor',
  '6-4-1': 'saturnImages', '6-4-2': 'radioOccultation', '6-4-3': 'platformRecovered',
  '7-1-1': ['orbitMeasured', 'dragonSeparated'], '7-2-1': 'dragonNoseOpen', '7-2-2': 'phasingBurn', '7-3-1': 'issHoldClearances',
  '7-3-2': 'idaCaptured', '7-3-3': 'corridorPreserved', '7-3-4': 'dockingGold', '7-4-1': 'cargoUnloaded', '7-4-2': 'coldSamplesLoaded',
  '7-5-1': ['undocked', 'retreatBurn'], '7-5-2': ['deorbitBurn', 'trunkSeparated', 'entryCorridor', 'dragonParachutes'],
  '7-5-3': 'splash', '7-5-4': 'coldSamplesDelivered',
};
export function historicalPlan(id) {
  const source = historicalCatalog[id]; if (!source) return null;
  const objectives = source.objectives.map(o => ({ ...o, signals: [].concat(signalRules[o.id] ?? []), dependencies: [] }));
  if (id === 'mars_science_laboratory') objectives.unshift(...historicalCatalog.mars_2020.objectives.filter(o => o.stage <= 3 && o.id !== '3-3-5').map(o => ({ ...o, id: 'msl-' + o.id, signals: [].concat(signalRules[o.id]), dependencies: [] })));
  if (id === 'voyager_2') for (const body of ['Uranus', 'Neptune']) objectives.push({ id: 'future-' + body, name: body + '  · future stage', tier: 'bonus', future: true, signals: [], dependencies: [] });
  return { id, context: source.context, objectives, spec: { crewCount: 0 }, executable: true };
}
export function validatedHistoricalSignals(flight, type, d = {}) {
  const signals = new Set(), e = flight.surfaceExpedition;
  const add = (name, ok = true) => { if (ok) signals.add(name); };
  // Measurements can be observed every step without granting anything by time.
  const orbit = flight.launch.orbit, targetM = flight.id === 'apollo_11' ? 185000 : flight.launch.vehicle.guidance.targetAltitudeM;
  if (orbit.energy < 0 && Math.abs(orbit.periapsisM - targetM) <= 30000 && Math.abs(orbit.apoapsisM - targetM) <= 100000) {
    add('orbitMeasured'); add('qWithinLimit', flight.systems.peakPressure * 1000 <= flight.launch.vehicle.guidance.maxDynamicPressurePa);
    add('manualOrbitMeasured', flight.rocketTest);
  }
  add('highEllipseMeasured', orbit.energy < 0 && Math.abs(orbit.periodS - 86400) < 8640);
  if (type === 'computerDecision') add(type, d.go === true);
  if (type === 'landerTouchdown') {
    const safe = ['excellent', 'hard'].includes(d.status);
    add(type, safe); add('landingGold', d.verticalMps <= .6 && d.status === 'excellent');
    add('landingReserve', safe && d.reserveS > 20); add('landingAccuracy', safe && d.rangeM <= 15);
  }
  if (type === 'equipmentInstalled') add(type + ':' + d.id, d.levelled === true && d.aligned === true);
  if (type === 'sampleCollected') { add(type + ':' + d.id, d.massKg > 0); add('sampleMass', d.totalKg >= 20 && e?.objects.some(o => /^sample[024]$/.test(o.id) && o.done) && e?.objects.some(o => /^sample[135]$/.test(o.id) && o.done)); }
  if (type === 'evaReturned') add(type, d.massKg >= 20 && d.remainingS > 0);
  if (type === 'surfacePhoto') { add('evaPhotos', d.image && d.count >= 7); add('helicopterThreePhotos', d.image && e?.current.profile === 'helicopter' && d.count >= 3); }
  if (type === 'surfacePhoto' && d.image) {
    add('conglomeratePhoto', d.target === 'conglomerate' && d.actor === 'curiosity');
    add('helicopterDebrisPhoto', d.target === 'craneDebris' && d.actor === 'ingenuity');
  }
  if (type === 'roverReturned') { add(type, d.distanceM > 10); add('delayedRoute', flight.manualControl.assistance === 'realism' && d.distanceM > 10); }
  if (type === 'rockDrilled') { add('threeRockTypes', d.sealed && d.types >= 3); add('johnKleinDrilled', ['John Klein', 'Джон Кляйн'].includes(d.rock) && d.massKg > 0); }
  if (type === 'laserAnalysis') { add(type + ':' + d.target); add('fiveLaserTargets', d.count >= 5); }
  if (type === 'sandScooped') add(type, d.sieved && d.massKg > 0);
  if (type === 'laboratoryAnalysis') { add(d.instrument === 'SAM' ? 'samPowder' : d.sample === 'sand' ? 'cheminSand' : 'cheminPowder', d.data); }
  if (type === 'habitabilityDiscovery') add(type, d.sand === true && d.powder === true && d.minerals >= 2);
  if (type === 'tubeDeposited') add('tubeDepotTen', d.count >= 10 && d.spaced);
  if (type === 'helicopterLanded' && d.verticalMps <= 1 && !d.emergency) {
    add('firstHelicopterFlight', d.hoverSeconds >= 30 && d.maxAltitudeM >= 2.7);
    if (d.home && d.position) {
      const distance = Math.hypot(d.position[0] - d.home[0], d.position[2] - d.home[2]);
      add('helicopterLateral', Math.abs(d.position[0] - d.home[0]) >= 2);
      add('helicopterFiftyReturn', d.maxRangeM >= 50 && distance <= 2);
      add('helicopterNewAirfield', distance >= 15);
    }
  }
  if (type === 'helicopterDeployed') add(type, d.deployed === true && d.distanceM > 1);
  if (type === 'firstNightHeated') add(type, d.energyJ > 0 && d.reserveJ > 0);
  if (type === 'moxieProduced') add(type, d.oxygenG > 0 && d.energyJ > 0);
  if (type === 'marsMicrophone') add(type, d.recording === true && d.energyJ > 0);
  if (type === 'roverWaypoint' && d.id === 'sharp') add('sharpTraverse', d.distanceM > 25 && d.wear < 1);
  if (type === 'splash') add(type, flight.surface === 'ocean' && flight.speed <= 12);
  if (type === 'contactShutdown') add(type, flight.localLanding?.contact && flight.localLanding.throttle === 0);
  if (type === 'eagleExtracted') { add(type, d.fixedJoint && d.distanceM >= 3); add('rcsBudget', d.rcsKg < 20); }
  if (type === 'lunarAscentIgnition') add('lunarAscentBurn', Math.abs(d.windowErrorS) <= 60 && d.throttle === 1 && d.massKg > 4000);
  if (type === 'flagFell') add(type, d.exhaustN > 0);
  if (type === 'columbiaCaptured') add(type, d.fixedJoint && d.speedMps <= .2 && d.lateralM <= .2 && d.angleRad <= 4 * Math.PI / 180);
  if (type === 'crewAndSamplesTransferred') add(type, d.crewCount === 3 && d.sampleKg >= 20 && d.target === 'columbia');
  if (type === 'serviceSeparated') add(type, d.separated === true);
  if (type === 'parachutes') add(type, flight.kind === 'reentry' && flight.altitude < 10 && flight.speed < 200);
  if (type === 'icpsHold') add(type, d.holdS >= 60 && d.driftM <= .5);
  if (type === 'icpsCircuit') { add(type, d.waypoints === 5 && d.rangeM >= 48); add('rcsBudget', d.rcsKg < 20); }
  if (type === 'marsEntry') add(type, d.altitudeM >= 120000 && d.speedMps > 3000);
  if (type === 'rangeTrigger') { add(type, d.heightM >= 5500 && d.speedMps <= 550); add('entryBankRange', d.rangeM < 15000); }
  if (type === 'safeSiteSelected') add(type, d.safe === true && d.slopeDeg < 10);
  if (type === 'poweredDescent') add(type, d.fuelKg > 0 && d.thrustN > 0);
  if (type === 'skyCraneTouchdown') add(type, d.verticalMps <= .75 && d.ropeM > 7);
  if (type === 'rosaDeployed') add(type, d.arrays === 2 && d.extended === true);
  if (type === 'voyagerBooms') add(type, d.booms >= 2 && d.deployed);
  if (type === 'dragonNoseOpen') add(type, d.portExposed === true);
  if (type === 'dragonSeparated') add(type, d.separated === true);
  if (type === 'undocked') add(type, d.jointReleased === true);
  if (type === 'dragonParachutes') add(type, d.drogue === 2 && d.main === 4 && d.altitudeM < 2000);
  if (type === 'retreatBurn') add(type, d.deltaVMps > 0 && d.undocked === true);
  if (type === 'trunkSeparated') add(type, d.separated === true);
  if (type === 'issHoldClearances') add(type, d.validated === true && d.count === 3);
  if (type === 'idaCaptured') {
    add(type, d.fixedJoint && d.speedMps <= .2 && d.lateralM <= .2 && d.angleRad <= 4 * Math.PI / 180);
    add('corridorPreserved', d.fixedJoint && !d.corridorViolated);
    add('dockingGold', d.fixedJoint && d.speedMps <= .1 && d.lateralM <= .1);
  }
  if (type === 'dartMeasuredImpact' && d.target === 'dimorphos') {
    add('dimorphosImpact'); add('dartFifty', d.missM <= 50); add('dartGold', d.missM <= 20);
  }
  if (type === 'cubeFrame' && d.frame && d.rangeKm <= 90) {
    add('cubeThreeFrames', d.frames >= 3);
    add('cubeTailFrame', d.opposite === true);
  }
  // Dedicated controller events carry a numeric or geometric evidence object.
  const controlled = ['foilRecovered', 'tethersCut', 'craneFlyaway', 'heatshieldSeparated', 'cruiseSeparated', 'backshellSeparated', 'liciacubeReleased'];
  if (controlled.includes(type)) add(type, Object.keys(d).length > 0);
  if (type === 'objectiveEvidence' && d.signal && d.verified === true && d.measurement && Object.values(d.measurement).some(v => typeof v === 'number' || v === true)) add(d.signal);
  return signals;
}
export const missionBriefing = id => {
  const plan = historicalPlan(id); if (!plan) return '';
  return `${plan.context} Complete the primary objectives using measured flight events and science data.`;
};
