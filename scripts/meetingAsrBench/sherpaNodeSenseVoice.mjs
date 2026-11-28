import sherpa from 'sherpa-onnx-node';

const M = (process.env.ASR_BENCH_DIR || process.env.HOME + '/asr-bench') + '/models';
const t0 = performance.now();
const rec = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    senseVoice: {
      model: `${M}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/model.int8.onnx`,
      language: 'zh',
      useInverseTextNormalization: 1,
    },
    tokens: `${M}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tokens.txt`,
    numThreads: 4,
    provider: 'cpu',
  },
});
const vad = new sherpa.Vad(
  {
    sileroVad: {
      model: `${M}/silero_vad.onnx`,
      threshold: 0.5,
      minSpeechDuration: 0.25,
      minSilenceDuration: 0.3,
      maxSpeechDuration: 20,
      windowSize: 512,
    },
    sampleRate: 16000,
    numThreads: 1,
  },
  600,
);
const load = performance.now() - t0;
const wave = sherpa.readWave(process.argv[2], false);
const dur = wave.samples.length / wave.sampleRate;
const t1 = performance.now();
const out = [];
const decode = () => {
  while (!vad.isEmpty()) {
    const seg = vad.front(false);
    vad.pop();
    const s = rec.createStream();
    s.acceptWaveform({ samples: seg.samples, sampleRate: 16000 });
    rec.decode(s);
    out.push(`[${(seg.start / 16000).toFixed(1)}s] ${rec.getResult(s).text}`);
  }
};
for (let i = 0; i + 512 <= wave.samples.length; i += 512) {
  vad.acceptWaveform(wave.samples.subarray(i, i + 512));
  decode();
}
vad.flush();
decode();
const proc = (performance.now() - t1) / 1000;
console.log(
  JSON.stringify({
    runtime: process.versions.electron
      ? `electron ${process.versions.electron} (node ${process.versions.node})`
      : `node ${process.versions.node}`,
    arch: process.arch,
    audio_s: +dur.toFixed(1),
    load_s: +(load / 1000).toFixed(2),
    proc_s: +proc.toFixed(2),
    rtf: +(proc / dur).toFixed(4),
    rss_mb: Math.round(process.memoryUsage().rss / 1048576),
  }),
);
console.log(out.slice(0, 4).join('\n'));
