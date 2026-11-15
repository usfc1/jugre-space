// Broad to detailed, geographic WGS84 bounds [west, south, east, north].
// Separate from the metre-based Kennedy ground tiles: these rasters wrap the sphere.
export const earthImageryRegions = [
  { id:'southeast', file:'southeast.png', bounds:[-91,19,-71,39], width:4096, height:4096 },
  { id:'florida', file:'florida.png', bounds:[-85,23,-76,32], width:4096, height:4096 },
  { id:'space_coast', file:'space-coast.png', bounds:[-82.5,26,-78.5,30], width:3072, height:3072 },
];
export const earthImageryService = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer';

export function geographicImageryUV(longitude, latitude, bounds) {
  return [(longitude-bounds[0])/(bounds[2]-bounds[0]),(latitude-bounds[1])/(bounds[3]-bounds[1])];
}
