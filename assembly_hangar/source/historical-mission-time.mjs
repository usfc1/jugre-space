// Spacecraft event times (SCET), not delayed receipt times on Earth.
// Unknown operational intervals are explicitly approximate. Ongoing missions
// have no invented end date; the simulator presents only the recorded segment.
const get = (h, m = 0, s = 0) => h * 3600 + m * 60 + s;
const elapsed = (launch, utc) => (Date.parse(utc) - Date.parse(launch)) / 1000;
export const historicalMissions = {
  apollo_11: { launchUtc: '1969-07-16T13:32:00.000Z', precision: 'documented',
    source: 'https://www.nasa.gov/wp-content/uploads/static/apollo50th/pdf/A11_MissionReport.pdf',
    endUtc: '1969-07-24T16:50:35.000Z',
    ends: { orbit: get(2,44,16.2), moonTransfer: get(75,49,50.4), moonOrbit: get(100,12),
      separate: get(102,33,5.2), moonLanding: get(102,45,39.9), moonSurface: get(124,22,.8),
      rendezvous: get(135,23,42.3), earthReturn: get(195,3,6.4), reentry: get(195,18,35) },
    events: { tli: get(2,44,16.2), 'lm-extraction': get(4,17), 'lunar-orbit': get(75,55,47.9),
      landing: get(102,45,39.9), eva: get(109,24,15), rendezvous: get(128,3), splashdown: get(195,18,35) } },
  mars_2020: { launchUtc: '2020-07-30T11:50:00.000Z', endUtc: null, ongoing:true, precision: 'documented-to-minute',
    source: 'https://ntrs.nasa.gov/citations/20220000775',
    dates: { marsTransfer: '2021-02-18T20:36:50.000Z', marsLanding: '2021-02-18T20:43:49.000Z' },
    references: { entry: '2021-02-18T20:36:50.000Z', touchdown: '2021-02-18T20:43:49.000Z' },
    approximate: { orbit: 3600, marsSurface: 120 } },
  mars_science_laboratory: { launchUtc: '2011-11-26T15:02:00.000Z', endUtc: null, ongoing:true, precision: 'documented-to-minute',
    source: 'https://ntrs.nasa.gov/api/citations/20205008340/downloads/HKN%202020%20Space%20Communications%20and%20Navigation%20Technology%20Revised.pdf',
    dates: { marsTransfer: '2012-08-06T05:10:57.000Z', marsLanding: '2012-08-06T05:17:57.000Z' },
    references: { touchdown: '2012-08-06T05:17:57.000Z' }, approximate: { orbit: 3600, marsSurface: 120 },
    estimatedEvents: ['entry'] },
  dart: { launchUtc: '2021-11-24T06:21:00.000Z', endUtc: '2022-09-26T23:14:24.000Z', precision: 'documented-to-minute',
    source: 'https://ntrs.nasa.gov/api/citations/20230015804/downloads/DART%20Final%20Technical%20Report.pdf',
    dates: { asteroidTransfer: '2022-09-11T23:14:24.000Z', dartApproach: '2022-09-26T23:14:24.000Z' },
    references: { impact: '2022-09-26T23:14:24.000Z' },
    approximate: { orbit: 3600, dartRelease: 60, dartAftermath: 8 }, estimatedEvents: ['liciacube'] },
  voyager_2: { launchUtc: '1977-08-20T14:29:44.000Z', endUtc: null, ongoing:true, precision: 'documented-to-minute',
    source: 'https://science.nasa.gov/mission/voyager/voyager-2/',
    dates: { jupiterTransfer: '1979-07-09T22:29:00.000Z', saturnTransfer: '1981-08-26T01:21:00.000Z' },
    references: { jupiter: '1979-07-09T22:29:00.000Z', saturn: '1981-08-26T01:21:00.000Z',
      uranus: '1986-01-24T18:00:00.000Z', neptune: '1989-08-25T03:56:00.000Z' },
    approximate: { orbit: 3600, jupiterFlyby: 4*3600, saturnFlyby: 4*3600, escape: 86400 }, estimatedEvents: ['uranus', 'neptune'] },
};
// The final DRACO approach already uses the measured 6.1 km/s encounter model.
historicalMissions.dart.dates.dartCruise = new Date(Date.parse(historicalMissions.dart.endUtc) - 40000 / 6100 * 1000).toISOString();
historicalMissions.dart.references.liciacube = historicalMissions.dart.dates.asteroidTransfer;
historicalMissions.artemis_ii={launchUtc:null,endUtc:null,precision:'approximate',source:'https://www.nasa.gov/artemis-ii-press-kit/',approximate:{reentry:1500}};
historicalMissions.iss_resupply={launchUtc:null,endUtc:null,precision:'approximate',source:'https://www.nasa.gov/international-space-station/space-station-visiting-vehicles/',
  approximate:{orbit:18*3600,stationApproach:6*3600,docking:15*60,earthReturn:12*3600,reentry:25*60}};

export function applyHistoricalTime(id, mission) {
  const data = historicalMissions[id];
  if (!data) return;
  mission.history = data;
  let end = 0;
  for (const p of mission.phases) {
    const known = data.ends?.[p.kind] ?? (data.dates?.[p.kind] ? elapsed(data.launchUtc, data.dates[p.kind]) : null);
    p.timePrecision = known == null || data.estimatedEvents?.includes(p.kind) ? 'approximate' : data.precision;
    const duration = known == null ? data.approximate?.[p.kind] ?? p.duration : known - end;
    p.duration = Math.max(.001, duration);
    end += p.duration;
    p.endGET = end;
  }
}
export function historicalEvent(id, eventId) {
  const h = historicalMissions[id];
  if (!h) return null;
  const seconds = h.events?.[eventId] ?? (h.references?.[eventId] ? elapsed(h.launchUtc, h.references[eventId]) : null);
  return { seconds, utc: seconds == null ? null : new Date(Date.parse(h.launchUtc) + seconds * 1000).toISOString(),
    precision: seconds == null || h.estimatedEvents?.includes(eventId) ? 'approximate' : h.precision, source: h.source };
}
