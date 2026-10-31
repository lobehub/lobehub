import sys, time, json, os, resource, soundfile as sf
t0 = time.perf_counter()
from funasr import AutoModel
m = AutoModel(model='paraformer-zh', vad_model='fsmn-vad', punc_model='ct-punc', spk_model='cam++', disable_update=True, device=sys.argv[2] if len(sys.argv) > 2 else 'cpu')
load = time.perf_counter() - t0
wav = sys.argv[1]; a, sr = sf.read(wav, dtype='float32'); dur = len(a) / sr
t1 = time.perf_counter(); res = m.generate(input=wav, batch_size_s=300); proc = time.perf_counter() - t1
r = res[0]; sents = r.get('sentence_info', [])
rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576
print('RESULT ' + json.dumps({'engine': 'funasr-paraformer-zh+cam++(' + (sys.argv[2] if len(sys.argv) > 2 else 'cpu') + ')', 'wav': os.path.basename(wav), 'audio_s': round(dur, 1), 'threads': 'torch-default', 'load_s': round(load, 2), 'proc_s': round(proc, 2), 'rtf': round(proc / dur, 4), 'peak_rss_mb': round(rss), 'detected_speakers': len({s.get('spk') for s in sents}), 'text': r['text'], 'segments': [{'start': s['start'] / 1000, 'spk': s.get('spk'), 'text': s['text']} for s in sents]}, ensure_ascii=False))
