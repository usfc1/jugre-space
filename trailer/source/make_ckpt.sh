#!/bin/bash
# Flight checkpoints used by shot_flight.cjs (built from the game's own FlightState, as in its tests).
set -e
cd "$(dirname "$0")"; mkdir -p ckpt
for job in "apollo_11 moonOrbit" "apollo_11 moonSurface" "apollo_11 rendezvous" "apollo_11 reentry" \
           "artemis_ii lunarFlyby" "mars_2020 marsSurface" "mars_science_laboratory marsLanding" \
           "dart dartApproach" "iss_resupply docking"; do
  set -- $job; node gen.mjs $1 $2 short 0 "ckpt/$1-$2-short.json"
done
node gen.mjs apollo_11 reentry short 800 ckpt/reentry_800.json
node gen.mjs apollo_11 reentry short 900 ckpt/reentry_900.json
node gen_surface.mjs apollo_11 0.6 ckpt/lm_600m.json
node gen_surface.mjs mars_2020 6 ckpt/mars_6km.json
