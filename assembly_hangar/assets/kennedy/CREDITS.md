# Kennedy Space Center scene

Terrain imagery from the [USGS National Map Imagery Only basemap](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer), accessed November 8, 2026. Source rasters were resampled, colour-blended at tile boundaries and extended over areas of missing offshore imagery. The reconstructed buildings are game models.

The LC-39A and facilities detail layers use original orthoimagery from [USGS NAIP Plus](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer), retrieved November 14, 2026, instead of enlarging the basemap cache. Each detail texture is 4000 × 4000 pixels: 0.3375 m per texture pixel over the 1350 m launch-pad footprint and 1.65 m per texture pixel over the 6600 m facilities footprint. Texture sampling does not imply a finer native survey resolution. The source service combines NAIP and high resolution orthoimagery from multiple acquisition years. Borders are feathered into the parent raster in geographic coordinates; the interior retains the source colour and detail. Request extents, retrieval times and SHA-256 hashes are recorded in `sources.json`. Run `npm run fetch:kennedy-imagery` from `source/` to regenerate these assets, then `npm run build` to embed them for offline use.

- [NASA overview map and photo tour](https://public.ksc.nasa.gov/socs/wp-content/uploads/sites/31/2024/07/SOCS-Contract-Presolicitation-Conference-Photo-Tour-Presentation.pdf)
- [NASA history of Launch Complex 39](https://www.nasa.gov/wp-content/uploads/static/history/SP-350/ch-6-1.html)
- [NASA Vehicle Assembly Building dimensions](https://asd.gsfc.nasa.gov/archive/sm3a/press-site.html)
- [NASA Launch Pad 39B](https://www.nasa.gov/humans-in-space/exploration-ground-systems/launch-pad-39b/)
- [NASA Shuttle Landing Facility](https://www.nasa.gov/kennedy/partnerships/shuttlelandingfacility/)
