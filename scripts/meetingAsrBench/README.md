# Meeting notes: local ASR benchmark spike

These scripts reproduce the local open-source ASR / diarization measurements behind the meeting-notes design (T-810, a Feishu Minutes–style feature). They are research tooling and are not imported by the app.

- Design doc: https://lobehub.com/page/docs_pOWMx4PGSrp59QWz
- Raw benchmark output: https://lobehub.com/page/docs_P62A6BrP6MJ9izFW

## Headline results

Measured on Apple M4 Pro (48 GB), macOS 27.0.1. The test input is a synthetic 114.4 s, 3-speaker zh/en code-switched meeting (6× loop = 686.6 s).

| Engine                                                 | RTF   | Peak RSS | MER   |
| ------------------------------------------------------ | ----- | -------- | ----- |
| whisper.cpp large-v3-turbo q5_0 (Metal)                | 0.035 | 821 MB   | 3.2%  |
| sherpa-onnx SenseVoice-small int8, `language=zh` (VAD) | 0.013 | 946 MB   | 10.5% |
| sherpa-onnx streaming paraformer bilingual int8        | 0.025 | 828 MB   | 12.9% |
| faster-whisper large-v3-turbo (CPU int8, no Metal)     | 0.280 | 2195 MB  | 5.9%  |
| FunASR paraformer-zh + CAM++ (torch CPU)               | 0.153 | 5572 MB  | 8.1%  |

Diarization uses sherpa-onnx with pyannote-seg-3.0 + 3D-Speaker CAM++ (threshold 0.8, speaker count unknown). On the 686.6 s input it got DER 2.6% and assigned 84/84 turns to the right speaker, at RTF 0.04.

The end-to-end local refine pipeline (`e2e.py`) ran at RTF 0.074, about 4.4 min per hour of audio.

## Setup

```bash
export ASR_BENCH_DIR=~/asr-bench          # models/ and data/ live here
uv venv -p 3.11 && uv pip install sherpa-onnx faster-whisper pywhispercpp soundfile numpy jiwer cn2an
# models: sherpa-onnx GitHub releases (asr-models, speaker-segmentation-models, speaker-recongition-models),
# ggerganov/whisper.cpp on Hugging Face, faster-whisper via ModelScope (Systran/faster-whisper-small,
# pengzhendong/faster-whisper-large-v3-turbo). See bench.py for the exact file names.
```

## Run

```bash
python make_meeting.py                                         # synthesize test meeting via `lh generate tts`
SV_LANG=zh python bench.py sensevoice-int8 $ASR_BENCH_DIR/data/meeting.wav 4 >> results.jsonl
python score.py $ASR_BENCH_DIR/data/meeting_ref.json results.jsonl   # MER + English-term recall
TH=0.8 python diar.py campplus $ASR_BENCH_DIR/data/meeting.wav $ASR_BENCH_DIR/data/meeting_ref.json -1
python e2e.py $ASR_BENCH_DIR/data/meeting.wav $ASR_BENCH_DIR/data/meeting_ref.json
python funasr_bench.py $ASR_BENCH_DIR/data/meeting.wav cpu      # separate venv with funasr + torch
node sherpaNodeSenseVoice.mjs $ASR_BENCH_DIR/data/meeting.wav    # npm i sherpa-onnx-node
```

Under Electron, `sherpa-onnx-node` must be called with `readWave(path, false)` and `vad.front(false)`. With the default arguments, V8's memory cage rejects the call with `External buffers are not allowed`.
