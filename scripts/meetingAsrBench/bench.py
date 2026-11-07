"""Run one engine on one wav in an isolated process; print JSON metrics.
usage: python bench.py <engine> <wav> [threads]"""
import sys, time, json, os, re, resource
import numpy as np, soundfile as sf
M = os.path.join(os.environ.get('ASR_BENCH_DIR', os.path.expanduser('~/asr-bench')), 'models')
eng, wav = sys.argv[1], sys.argv[2]
threads = int(sys.argv[3]) if len(sys.argv) > 3 else 4
audio, sr = sf.read(wav, dtype='float32'); dur = len(audio) / sr
t0 = time.perf_counter()

def vad_segments(samples):
    import sherpa_onnx as so
    c = so.VadModelConfig(); c.silero_vad.model = f'{M}/silero_vad.onnx'
    c.silero_vad.min_silence_duration = 0.3; c.silero_vad.max_speech_duration = 20; c.sample_rate = 16000
    vad = so.VoiceActivityDetector(c, buffer_size_in_seconds=600)
    out = []; w = 512
    for i in range(0, len(samples), w):
        vad.accept_waveform(samples[i:i + w])
        while not vad.empty(): out.append((vad.front.start / 16000, np.array(vad.front.samples, dtype=np.float32))); vad.pop()
    vad.flush()
    while not vad.empty(): out.append((vad.front.start / 16000, np.array(vad.front.samples, dtype=np.float32))); vad.pop()
    return out

def offline_sherpa(rec):
    load = time.perf_counter() - t0; t1 = time.perf_counter(); segs = []
    global extra; lat = []
    for st, s in vad_segments(audio):
        a = time.perf_counter(); stm = rec.create_stream(); stm.accept_waveform(16000, s); rec.decode_stream(stm); lat.append((time.perf_counter() - a, len(s) / 16000))
        segs.append({'start': round(st, 2), 'text': stm.result.text})
    d = [x[0] * 1000 for x in lat]
    extra = {'num_segments': len(lat), 'per_segment_decode_ms_p50': round(float(np.median(d)), 1), 'per_segment_decode_ms_max': round(max(d), 1), 'max_segment_s': round(max(x[1] for x in lat), 1)}
    return load, time.perf_counter() - t1, segs

if eng.startswith('sensevoice'):
    import sherpa_onnx as so
    d = f'{M}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
    model = f'{d}/model.int8.onnx' if eng == 'sensevoice-int8' else f'{d}/model.onnx'
    rec = so.OfflineRecognizer.from_sense_voice(model=model, tokens=f'{d}/tokens.txt', num_threads=threads, provider=os.environ.get('PROVIDER','cpu'), use_itn=True, language=os.environ.get('SV_LANG','auto'))
    load, proc, segs = offline_sherpa(rec)
elif eng == 'paraformer-offline':
    import sherpa_onnx as so
    d = f'{M}/sherpa-onnx-paraformer-zh-2024-03-09'
    rec = so.OfflineRecognizer.from_paraformer(paraformer=f'{d}/model.int8.onnx', tokens=f'{d}/tokens.txt', num_threads=threads)
    load, proc, segs = offline_sherpa(rec)
elif eng in ('paraformer-streaming', 'zipformer-streaming'):
    import sherpa_onnx as so
    if eng == 'paraformer-streaming':
        d = f'{M}/sherpa-onnx-streaming-paraformer-bilingual-zh-en'
        rec = so.OnlineRecognizer.from_paraformer(tokens=f'{d}/tokens.txt', encoder=f'{d}/encoder.int8.onnx', decoder=f'{d}/decoder.int8.onnx', num_threads=threads, enable_endpoint_detection=True)
    else:
        d = f'{M}/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20'
        rec = so.OnlineRecognizer.from_transducer(tokens=f'{d}/tokens.txt', encoder=f'{d}/encoder-epoch-99-avg-1.int8.onnx', decoder=f'{d}/decoder-epoch-99-avg-1.onnx', joiner=f'{d}/joiner-epoch-99-avg-1.int8.onnx', num_threads=threads, enable_endpoint_detection=True)
    load = time.perf_counter() - t0; t1 = time.perf_counter()
    stm = rec.create_stream(); segs = []; chunk = 3200  # 200 ms frames, same as Dictation contract
    lat = []
    for i in range(0, len(audio), chunk):
        a = time.perf_counter(); stm.accept_waveform(16000, audio[i:i + chunk])
        while rec.is_ready(stm): rec.decode_stream(stm)
        lat.append(time.perf_counter() - a)
        if rec.is_endpoint(stm):
            r = rec.get_result(stm)
            if r: segs.append({'start': round(i / 16000, 2), 'text': r})
            rec.reset(stm)
    stm.accept_waveform(16000, np.zeros(8000, dtype=np.float32)); stm.input_finished()
    while rec.is_ready(stm): rec.decode_stream(stm)
    r = rec.get_result(stm)
    if r: segs.append({'start': round(dur, 2), 'text': r})
    proc = time.perf_counter() - t1
    extra = {'per_200ms_chunk_ms_p50': round(1000 * float(np.median(lat)), 2), 'per_200ms_chunk_ms_p99': round(1000 * float(np.percentile(lat, 99)), 2)}
elif eng.startswith('faster-whisper'):
    from faster_whisper import WhisperModel
    name = {'faster-whisper-small': f'{M}/ms/models/Systran--faster-whisper-small/snapshots/master', 'faster-whisper-turbo': f'{M}/ms/models/pengzhendong--faster-whisper-large-v3-turbo/snapshots/master'}[eng]
    m = WhisperModel(name, device='cpu', compute_type='int8', cpu_threads=threads)
    load = time.perf_counter() - t0; t1 = time.perf_counter()
    it, info = m.transcribe(audio, vad_filter=True, beam_size=1, condition_on_previous_text=False)
    segs = [{'start': round(s.start, 2), 'text': s.text} for s in it]
    proc = time.perf_counter() - t1
elif eng.startswith('whispercpp'):
    from pywhispercpp.model import Model
    f = {'whispercpp-small': 'ggml-small.bin', 'whispercpp-turbo-q5': 'ggml-large-v3-turbo-q5_0.bin'}[eng]
    m = Model(f'{M}/{f}', n_threads=threads, print_progress=False, print_realtime=False, redirect_whispercpp_logs_to=None)
    load = time.perf_counter() - t0; t1 = time.perf_counter()
    res = m.transcribe(audio, language='zh')
    segs = [{'start': round(s.t0 / 100, 2), 'text': s.text} for s in res]
    proc = time.perf_counter() - t1
else:
    raise SystemExit('unknown engine')

rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 / 1024  # macOS: bytes -> MB
out = {'engine': eng, 'wav': os.path.basename(wav), 'audio_s': round(dur, 1), 'threads': threads,
       'load_s': round(load, 2), 'proc_s': round(proc, 2), 'rtf': round(proc / dur, 4), 'peak_rss_mb': round(rss),
       'text': ''.join(s['text'] for s in segs), 'segments': segs}
if 'extra' in dir(): out.update(extra)
print('RESULT ' + json.dumps(out, ensure_ascii=False))
