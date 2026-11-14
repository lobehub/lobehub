"""usage: python diar.py <emb: eres2net|campplus> <wav> <ref.json> [num_speakers|-1] [reps]"""
import sys, time, json, os, resource, numpy as np, soundfile as sf, sherpa_onnx as so
from collections import Counter
M = os.path.join(os.environ.get('ASR_BENCH_DIR', os.path.expanduser('~/asr-bench')), 'models')
emb = {'eres2net': '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx', 'campplus': '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx'}[sys.argv[1]]
wav, ref = sys.argv[2], json.load(open(sys.argv[3])); n = int(sys.argv[4]) if len(sys.argv) > 4 else -1
reps = int(sys.argv[5]) if len(sys.argv) > 5 else 1
period = ref[-1]['end'] + 0.7
ref = [dict(r, start=r['start'] + k * period, end=r['end'] + k * period) for k in range(reps) for r in ref]
t0 = time.perf_counter()
cfg = so.OfflineSpeakerDiarizationConfig(
  segmentation=so.OfflineSpeakerSegmentationModelConfig(pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=f'{M}/sherpa-onnx-pyannote-segmentation-3-0/model.onnx'), num_threads=4),
  embedding=so.SpeakerEmbeddingExtractorConfig(model=f'{M}/{emb}', num_threads=4),
  clustering=so.FastClusteringConfig(num_clusters=n, threshold=float(os.environ.get('TH','0.5'))), min_duration_on=0.3, min_duration_off=0.5)
sd = so.OfflineSpeakerDiarization(cfg); load = time.perf_counter() - t0
audio, sr = sf.read(wav, dtype='float32'); dur = len(audio) / sr
t1 = time.perf_counter(); segs = sd.process(audio).sort_by_start_time(); proc = time.perf_counter() - t1
hyp = [(s.start, s.end, s.speaker) for s in segs]
# frame-level (10ms) speaker accuracy with optimal greedy mapping cluster->ref speaker (non-overlapping ref)
step = 0.01; T = int(dur / step) + 1; R = [None] * T; H = [None] * T
for r in ref:
  for i in range(int(r['start'] / step), min(T, int(r['end'] / step))): R[i] = r['speaker']
for s, e, k in hyp:
  for i in range(int(s / step), min(T, int(e / step))): H[i] = k
pairs = Counter((h, r) for h, r in zip(H, R) if h is not None and r is not None)
mapping = {}; used = set()
for (h, r), c in pairs.most_common():
  if h not in mapping and r not in used: mapping[h] = r; used.add(r)
speech = sum(1 for r in R if r is not None)
miss = sum(1 for h, r in zip(H, R) if r is not None and h is None)
fa = sum(1 for h, r in zip(H, R) if r is None and h is not None)
conf = sum(1 for h, r in zip(H, R) if r is not None and h is not None and mapping.get(h) != r)
# turn-level: majority cluster per ref turn
turn_ok = 0
for r in ref:
  c = Counter(H[i] for i in range(int(r['start'] / step), int(r['end'] / step)) if H[i] is not None)
  turn_ok += bool(c) and mapping.get(c.most_common(1)[0][0]) == r['speaker']
rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576
print('RESULT ' + json.dumps({'engine': f'diar-pyannote3+{sys.argv[1]}', 'num_speakers_hint': n, 'threshold': float(os.environ.get('TH','0.5')), 'audio_s': round(dur, 1), 'load_s': round(load, 2), 'proc_s': round(proc, 2), 'rtf': round(proc / dur, 4), 'peak_rss_mb': round(rss),
  'detected_speakers': len(set(k for *_, k in hyp)), 'ref_speakers': len(set(r['speaker'] for r in ref)), 'DER': round((miss + fa + conf) / speech, 4), 'miss': round(miss / speech, 4), 'false_alarm': round(fa / speech, 4), 'confusion': round(conf / speech, 4), 'turn_speaker_acc': f'{turn_ok}/{len(ref)}'}))
