#!/bin/bash
# Full trailer build: edit list -> composited frames -> score -> MP4
set -e
cd "$(dirname "$0")"
export NODE_PATH=$(npm root -g)
node make_edit.cjs
rm -rf out/frames && mkdir -p out/frames
node comp/render.cjs comp/edit.js out/frames 0 1000
python3 audio/score.py .
ffmpeg -v error -y -f f32le -ar 48000 -ac 2 -i audio/mix_raw.f32 -af loudnorm=I=-14:TP=-1.0:LRA=11 -ar 48000 -c:a pcm_s16le audio/mix.wav
ffmpeg -v error -y -framerate 30 -i out/frames/o%05d.jpg -i audio/mix.wav \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -profile:v high -tune film -g 60 \
  -c:a aac -b:a 256k -movflags +faststart -shortest out/JUGRE_Space_Project_Trailer_1080p.mp4
ls -la out/*.mp4
