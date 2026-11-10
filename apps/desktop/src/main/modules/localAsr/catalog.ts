import type { LocalAsrModelPackId } from '@lobechat/electron-client-ipc';

export interface LocalAsrModelFile {
  name: string;
  sha256: string;
  size: number;
  /** Tried in order; the first that answers 2xx wins */
  urls: string[];
}

export interface LocalAsrModelPack {
  description: string;
  files: LocalAsrModelFile[];
  id: LocalAsrModelPackId;
  required: boolean;
}

const hf = (repo: string, file: string) => [
  `https://huggingface.co/${repo}/resolve/main/${file}`,
  `https://hf-mirror.com/${repo}/resolve/main/${file}`,
];

const SHERPA_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const SENSE_VOICE_REPO = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
const PYANNOTE_REPO = 'csukuangfj/sherpa-onnx-pyannote-segmentation-3-0';
const SPEAKER_EMBEDDING_REPO = 'csukuangfj/speaker-embedding-models';
const CAMPPLUS_FILE = '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx';

/**
 * Model packs for the local engine. Hashes and sizes were measured against the
 * upstream files (T-810 benchmark); a download that does not match is discarded.
 */
export const LOCAL_ASR_MODEL_PACKS: LocalAsrModelPack[] = [
  {
    description: 'SenseVoice-small int8 (zh/en/ja/ko/yue) + silero VAD',
    files: [
      {
        name: 'sense-voice-int8.onnx',
        sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
        size: 239_233_841,
        urls: hf(SENSE_VOICE_REPO, 'model.int8.onnx'),
      },
      {
        name: 'sense-voice-tokens.txt',
        sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
        size: 315_894,
        urls: hf(SENSE_VOICE_REPO, 'tokens.txt'),
      },
      {
        name: 'silero_vad.onnx',
        sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
        size: 643_854,
        urls: [`${SHERPA_RELEASE}/asr-models/silero_vad.onnx`],
      },
    ],
    id: 'asr-sensevoice',
    required: true,
  },
  {
    description: 'pyannote segmentation 3.0 + 3D-Speaker CAM++ (zh/en)',
    files: [
      {
        name: 'pyannote-segmentation-3-0.onnx',
        sha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079',
        size: 5_992_913,
        urls: hf(PYANNOTE_REPO, 'model.onnx'),
      },
      {
        name: 'campplus-sv-zh-en-16k.onnx',
        sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
        size: 28_281_164,
        urls: [
          ...hf(SPEAKER_EMBEDDING_REPO, CAMPPLUS_FILE),
          `${SHERPA_RELEASE}/speaker-recongition-models/${CAMPPLUS_FILE}`,
        ],
      },
    ],
    id: 'diarization',
    required: false,
  },
];

export const getModelPack = (id: LocalAsrModelPackId) => {
  const pack = LOCAL_ASR_MODEL_PACKS.find((item) => item.id === id);
  if (!pack) throw new Error(`Unknown local ASR model pack: ${id}`);
  return pack;
};

export const getPackSize = (pack: LocalAsrModelPack) =>
  pack.files.reduce((sum, file) => sum + file.size, 0);
