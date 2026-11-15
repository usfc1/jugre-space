export const kennedyTiles = [
  { id: 'florida', bounds: [-53000, -42000, 37000, 48000] },
  { id: 'region', bounds: [-24500, -15500, 10500, 19500] },
  { id: 'campus', bounds: [-8900, -5900, 2300, 5300] },
  { id: 'facilities', bounds: [-5600, -3000, 1000, 3600], width: 4000, featherM: 600 },
  { id: 'pad39a', bounds: [-675, -675, 675, 675], width: 4000, featherM: 90 },
];

export const kennedyImagerySource = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer';
export const kennedyAnchor = { latitude: 28.6084, longitude: -80.6042 };

// Metres east and south of the 39A launch table.
export const kennedySites = {
  pad39a: [0, 0],
  pad39b: [-1625, -2110],
  vab: [-4630, 2330],
  lcc: [-4490, 2424],
  runway: [-8875, -745],
  basin: [-3810, 2820],
  titusville: [-21250, 1600],
};

export const kennedyCameras = {
  pad: { position: [206, 134, 242], target: [0, 48, 0] },
  padTop: { position: [0, 1580, 0.1], target: [0, 0, 0] },
  tower: { position: [-118, 72, 158], target: [-3, 61, -5] },
  overview: { position: [3920, 6450, 7990], target: [-3720, 0, -230] },
  vab: { position: [-4390, 177, 2790], target: [-4630, 76, 2360] },
  pad39b: { position: [-1190, 260, -1710], target: [-1625, 44, -2110] },
  coast: { position: [-4550, 9620, 14100], target: [-9700, 0, 350] },
};
