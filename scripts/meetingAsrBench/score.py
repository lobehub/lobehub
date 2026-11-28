import json, re, sys, cn2an, jiwer
TERMS = ['review','q4','roadmap','meeting notes','asr','streaming','session','websocket','s3','batch transcription','desktop','sensevoice','whisper','macbook','sherpa','onnx','small','rtf','pyannote','3d','speaker','diarization','pipeline','summary','key decisions','action item','lobehub','task','assignee','pr','benchmark']
def norm(t):
    t = t.lower()
    try: t = cn2an.transform(t, 'an2cn')
    except Exception: pass
    t = re.sub(r'<\|[^|]*\|>', '', t)
    t = re.sub(r'[^\w一-鿿]', '', t)
    return t
def chars(t):  # CJK chars + english words as tokens (MER-style)
    return re.findall(r'[一-鿿]|[a-z0-9]+', t)
def tok(t):
    t = t.lower()
    try: t = cn2an.transform(t, 'an2cn')
    except Exception: pass
    t = re.sub(r'<\|[^|]*\|>', '', t)
    return ' '.join(chars(t))
ref = json.load(open(sys.argv[1])); reps = int(sys.argv[3]) if len(sys.argv) > 3 else 1
rtext = ''.join(s['text'] for s in ref) * reps
for line in open(sys.argv[2]):
    if not line.startswith('RESULT '): continue
    r = json.loads(line[7:])
    mer = jiwer.wer(tok(rtext), tok(r['text']))
    h = r['text'].lower().replace(' ', '')
    recall = sum(1 for t in TERMS if t.replace(' ', '') in h) / len(TERMS)
    print(json.dumps({k: r.get(k) for k in ['engine','wav','audio_s','threads','load_s','proc_s','rtf','peak_rss_mb','per_200ms_chunk_ms_p50','per_200ms_chunk_ms_p99']} | {'MER': round(mer, 4), 'en_term_recall': round(recall, 3)}, ensure_ascii=False))
