# Photographic Earth detail for flight

Source: [USGS The National Map — Imagery Only](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer), retrieved November 12, 2026. Attribution: USDA / USGS The National Map: Orthoimagery. The service combines NAIP aerial photography, Landsat and Blue Marble, according to its published service metadata. These images are a mosaic of acquisition dates, not live imagery.

The service exported the following rasters directly in **EPSG:4326 / WGS84**, with north at the top. Bounds are west, south, east, north:

| File | Bounds, degrees | Resolution |
| --- | --- | --- |
| `southeast.png` | −91, 19, −71, 39 | 4096 × 4096 |
| `florida.png` | −85, 23, −76, 32 | 4096 × 4096 |
| `space-coast.png` | −82.5, 26, −78.5, 30 | 3072 × 3072 |

`sources.json` records the service, projection, bounds, dimensions, retrieval times and SHA-256 hashes. Run `npm run fetch:earth-imagery` in `assembly_hangar/source` to reproduce the exports. Valid-size files are reused; remove the specific local raster first if a fresh source export is desired.

The original PNGs are preserved. At render time, geographic samples are blended from broad coverage to detailed coverage, with feathered edges. Transparent or opaque white/black no-data pixels are rejected. Coarse offshore bathymetry is left to the existing base ocean to avoid rectangular ocean seams. Existing detailed Kennedy imagery is applied above these regional layers near the launch complex. The same geographic shader is used for ascent and the Earth globe.

Rasters and source metadata are embedded in the offline game build; the running game makes no requests to USGS. The base global Earth texture retains its separate attribution in [the space texture credits](../space/CREDITS.md).
