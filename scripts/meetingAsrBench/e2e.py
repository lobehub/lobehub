"""Local post-meeting refine: whisper.cpp(turbo q5, Metal) + sherpa-onnx diarization (pyannote-3.0 + CAM++), merged by time overlap."""
import sys, os, time, json, resource, numpy as np, soundfile as sf, sherpa_onnx as so
from collections import Counter
from pywhispercpp.model import Model
M = os.path.join(os.environ.get('ASR_BENCH_DIR', os.path.expanduser('~/asr-bench')), 'models'); wav = sys.argv[1]
audio, sr = sf.read(wav, dtype='float32'); dur = len(audio) / sr; t0 = time.perf_counter()
w = Model(f'{M}/ggml-large-v3-turbo-q5_0.bin', n_threads=4, print_progress=False, print_realtime=False, redirect_whispercpp_logs_to=None)
asr = [(s.t0 / 100, s.t1 / 100, s.text) for s in w.transcribe(audio, language='zh')]; t_asr = time.perf_counter() - t0
cfg = so.OfflineSpeakerDiarizationConfig(
  segmentation=so.OfflineSpeakerSegmentationModelConfig(pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=f'{M}/sherpa-onnx-pyannote-segmentation-3-0/model.onnx'), num_threads=4),
  embedding=so.SpeakerEmbeddingExtractorConfig(model=f'{M}/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx', num_threads=4),
  clustering=so.FastClusteringConfig(num_clusters=-1, threshold=0.8), min_duration_on=0.3, min_duration_off=0.5)
t1 = time.perf_counter(); dia = [(s.start, s.end, s.speaker) for s in so.OfflineSpeakerDiarization(cfg).process(audio).sort_by_start_time()]; t_dia = time.perf_counter() - t1
def spk(a, b):
  c = Counter()
  for s, e, k in dia: c[k] += max(0, min(b, e) - max(a, s))
  return c.most_common(1)[0][0] if c and c.most_common(1)[0][1] > 0 else None
lines = []; cur = None
for a, b, t in asr:
  k = spk(a, b)
  if cur and cur['speaker'] == k: cur['end'] = b; cur['text'] += t
  else: cur = {'speaker': k, 'start': a, 'end': b, 'text': t}; lines.append(cur)
ref = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else None
for l in lines: print(f"[{int(l['start']//60):02d}:{l['start']%60:05.2f}] 说话人{l['speaker']+1 if l['speaker'] is not None else '?'}: {l['text']}")
# map hyp speaker -> ref speaker by majority over ref turns
if ref:
  mp = Counter((spk(r['start'], r['end']), r['speaker']) for r in ref); m = {}
  for (h, r), _ in mp.most_common():
    if h not in m and r not in m.values(): m[h] = r
  ok = sum(m.get(spk(r['start'], r['end'])) == r['speaker'] for r in ref)
print('E2E ' + json.dumps({'audio_s': round(dur, 1), 'asr_s': round(t_asr, 2), 'diar_s': round(t_dia, 2), 'total_s': round(time.perf_counter() - t0, 2), 'rtf_total': round((time.perf_counter() - t0) / dur, 4), 'speakers': len({k for *_, k in dia}), 'turn_speaker_acc': f'{ok}/{len(ref)}' if ref else None, 'peak_rss_mb': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576)}))
