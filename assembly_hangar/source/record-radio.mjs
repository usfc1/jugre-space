import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { radioLines, speakers } from './mission-radio.mjs';

const [toolsDir, modelDir, ffmpeg = 'ffmpeg', ...only] = process.argv.slice(2);
if (!toolsDir || !modelDir) {
  throw new Error('Usage: node record-radio.mjs <kokoro npm project> <local Kokoro model dir> <ffmpeg> [line ids...]');
}
const require = createRequire(resolve(toolsDir, 'package.json'));
const { KokoroTTS } = require('kokoro-js');
const tts = await KokoroTTS.from_pretrained(resolve(modelDir).replaceAll('\\', '/'), {
  dtype: 'q8', device: 'cpu', local_files_only: true,
});
const output = new URL('../assets/audio/radio/', import.meta.url);
await mkdir(output, { recursive: true });

function trim(samples, rate) {
  const window = Math.floor(rate * .012);
  let start = samples.length;
  let end = 0;
  let peak = .12;
  for (let i = 0; i < samples.length; i += window) {
    let energy = 0;
    for (let j = i; j < Math.min(samples.length, i + window); j++) {
      peak = Math.max(peak, Math.abs(samples[j]));
      energy += samples[j] ** 2;
    }
    if (energy / window > .000052) {
      start = Math.min(start, i);
      end = i + window;
    }
  }
  if (!end) throw new Error('Silent speech output');
  const pcm = samples.slice(Math.max(0, start - window), Math.min(samples.length, end + window * 3));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] *= .88 / peak * Math.min(1, i / (window / 2), (pcm.length - i - 1) / window);
  }
  return pcm;
}

for (const [id, line] of Object.entries(radioLines)) {
  if (only.length && !only.includes(id)) continue;
  const { voice, speed } = speakers[line.speaker];
  const sample = await tts.generate(line.en, { voice, speed: id === 'count_10' ? 1.12 : speed });
  const rate = sample.sampling_rate;
  const pcm = trim(sample.audio, rate);
  const filters = ['highpass=f=100'];
  const duration = pcm.length / rate;
  if (id.startsWith('count_') && duration > .88) filters.push(`atempo=${(duration / .88).toFixed(4)}`);
  const file = fileURLToPath(new URL(`${id}.mp3`, output));
  const encoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le',
    '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-af', filters.join(','), '-c:a', 'libmp3lame',
    '-b:a', '48k', file], { input: Buffer.from(pcm.buffer), encoding: 'utf8', windowsHide: true });
  if (encoded.status !== 0) throw new Error(encoded.stderr || String(encoded.error));
  console.log(`${id}: ${duration.toFixed(2)} s before encoding`);
}
