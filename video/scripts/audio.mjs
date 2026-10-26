import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// An original, deterministic instrumental bed. No samples or remote assets are used.
const sampleRate = 44_100;
const session = JSON.parse(readFileSync(new URL('../public/session/manifest.json', import.meta.url)));
const duration = session.duration + 7;
const frames = Math.round(sampleRate * duration);
const left = new Float64Array(frames);
const right = new Float64Array(frames);
const tempo = 100;
const beat = 60 / tempo;
const tau = 2 * Math.PI;
const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
const smoothstep = (x) => {
  const clamped = Math.max(0, Math.min(1, x));
  return clamped * clamped * (3 - 2 * clamped);
};

// Eighth-note pulses sit beneath warm C-major/add-nine harmony.
const harmony = [
  [48, 55, 59, 64, 74], // Cmaj9
  [45, 52, 55, 60, 71], // Am9
  [41, 48, 52, 57, 67], // Fmaj9
  [43, 50, 55, 57, 64], // G6/9
];

function addVoice(start, length, pan, gain, sample) {
  const first = Math.max(0, Math.round(start * sampleRate));
  const last = Math.min(frames, Math.round((start + length) * sampleRate));
  const leftGain = Math.cos((pan + 1) * Math.PI / 4) * gain;
  const rightGain = Math.sin((pan + 1) * Math.PI / 4) * gain;
  for (let i = first; i < last; i += 1) {
    const value = sample(i / sampleRate - start);
    left[i] += value * leftGain;
    right[i] += value * rightGain;
  }
}

function pad(start, midi, length, pan, gain, phase) {
  const pitch = frequency(midi);
  addVoice(start, length, pan, gain, (time) => {
    const envelope = smoothstep(time / 0.65) * smoothstep((length - time) / 0.85);
    const oscillator = Math.sin(tau * pitch * time + phase)
      + 0.24 * Math.sin(tau * pitch * 1.0025 * time + phase + 0.4)
      + 0.11 * Math.sin(tau * pitch * 2 * time + phase);
    return envelope * oscillator / 1.35;
  });
}

function pluck(start, midi, gain, pan) {
  const pitch = frequency(midi);
  const length = 2.1;
  const pluckedSample = (time) => {
    const envelope = smoothstep(time / 0.012) * Math.exp(-time * 3.8)
      * smoothstep((length - time) / 0.3);
    // Soft odd harmonics provide a rounded, muted triangle-like attack.
    const oscillator = Math.sin(tau * pitch * time)
      - 0.105 * Math.sin(tau * pitch * 3 * time) * Math.exp(-time * 7)
      + 0.028 * Math.sin(tau * pitch * 5 * time) * Math.exp(-time * 11);
    return oscillator * envelope;
  };
  addVoice(start, length, pan, gain, pluckedSample);
  // Quiet alternating taps add space without a long, distracting reverb tail.
  addVoice(start + beat * 0.75, length, -pan, gain * 0.19, pluckedSample);
  addVoice(start + beat * 1.5, length, pan * 0.55, gain * 0.065, pluckedSample);
}

function bass(start, midi, gain) {
  const pitch = frequency(midi);
  const length = beat * 1.85;
  addVoice(start, length, 0, gain, (time) => {
    const envelope = smoothstep(time / 0.045) * Math.exp(-time * 2.1)
      * smoothstep((length - time) / 0.25);
    return envelope * (Math.sin(tau * pitch * time)
      + 0.12 * Math.sin(tau * pitch * 2 * time)) / 1.12;
  });
}

// Short bars follow the measured session duration and resolve to a closing tonic.
const bars = Math.ceil(duration / (4 * beat));
for (let bar = 0; bar < bars; bar += 1) {
  const start = bar * 4 * beat;
  const chord = harmony[bar === bars - 1 ? 0 : bar % harmony.length];
  chord.forEach((note, index) => {
    const pan = [-0.55, 0.5, -0.3, 0.3, 0][index];
    pad(start - (bar === 0 ? 0 : 0.25), note + (index === 0 ? 12 : 0), 3.15,
      pan, index === 4 ? 0.027 : 0.043, index * 0.57);
  });

  bass(start + 0.025, chord[0] - 12, bar === 0 ? 0.06 : 0.085);
  if (bar > 0 && bar < bars - 1) bass(start + 2 * beat, chord[0] - 12, 0.055);

  if (bar > 0 && bar < bars - 1) {
    const pattern = bar % 2 === 0 ? [2, 3, 4, 3, 1, 3] : [3, 1, 2, 4, 3, 2];
    const offsets = [0.5, 1.25, 2, 2.5, 3.25, 3.75];
    pattern.forEach((index, step) => {
      const octave = index < 2 ? 12 : 0;
      pluck(start + offsets[step] * beat, chord[index] + octave,
        (step % 3 === 0 ? 0.066 : 0.045) * (bar < 3 ? 0.7 : 1),
        step % 2 === 0 ? -0.34 : 0.34);
    });
  }
}

// A simple answering phrase creates gentle landmarks at each visual chapter.
[[9.6, 76], [10.5, 74], [18.9, 72], [19.8, 71], [28.8, 76], [29.7, 79],
  [37.2, 74], [38.1, 72], [46.8, 76], [47.7, 74], [duration - 4.2, 72]].forEach(([start, note], index) => {
  pluck(start, note, 0.053, index % 2 === 0 ? -0.18 : 0.18);
});

let peakBefore = 0;
let squareSumBefore = 0;
for (let i = 0; i < frames; i += 1) {
  const time = i / sampleRate;
  const fade = smoothstep(time / 0.5) * smoothstep((duration - time) / 2);
  left[i] *= fade;
  right[i] *= fade;
  peakBefore = Math.max(peakBefore, Math.abs(left[i]), Math.abs(right[i]));
  squareSumBefore += left[i] ** 2 + right[i] ** 2;
}

// Keep ample headroom; Remotion adds its own final presentation volume.
const rmsBefore = Math.sqrt(squareSumBefore / (frames * 2));
const gain = Math.min(0.62 / peakBefore, 0.12 / rmsBefore);
const bytesPerFrame = 4;
const pcmBytes = frames * bytesPerFrame;
const wav = Buffer.alloc(44 + pcmBytes);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + pcmBytes, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * bytesPerFrame, 28);
wav.writeUInt16LE(bytesPerFrame, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(pcmBytes, 40);
let peak = 0;
let squareSum = 0;
for (let i = 0; i < frames; i += 1) {
  const l = Math.round(left[i] * gain * 32_767);
  const r = Math.round(right[i] * gain * 32_767);
  wav.writeInt16LE(l, 44 + i * bytesPerFrame);
  wav.writeInt16LE(r, 46 + i * bytesPerFrame);
  peak = Math.max(peak, Math.abs(l) / 32_767, Math.abs(r) / 32_767);
  squareSum += (l / 32_767) ** 2 + (r / 32_767) ** 2;
}

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../public/audio/folio.wav');
mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, wav);
console.log(JSON.stringify({
  output,
  durationSeconds: frames / sampleRate,
  sampleRate,
  channels: 2,
  bitsPerSample: 16,
  tempo,
  peak: Number(peak.toFixed(6)),
  rms: Number(Math.sqrt(squareSum / (frames * 2)).toFixed(6)),
  bytes: wav.length,
}, null, 2));
