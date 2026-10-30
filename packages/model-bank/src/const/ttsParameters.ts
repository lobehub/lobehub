import type { TTSModelParamsSchema, TTSVoice } from '../standard-parameters';
import { TTS_AUDIO_FORMATS } from '../standard-parameters';

/**
 * Built-in OpenAI voices.
 * @see https://platform.openai.com/docs/guides/text-to-speech#voice-options
 */
const OPENAI_TTS_1_VOICES: TTSVoice[] = [
  { displayName: 'Alloy', gender: 'neutral', id: 'alloy', language: 'multilingual' },
  { displayName: 'Ash', gender: 'male', id: 'ash', language: 'multilingual' },
  { displayName: 'Coral', gender: 'female', id: 'coral', language: 'multilingual' },
  { displayName: 'Echo', gender: 'male', id: 'echo', language: 'multilingual' },
  { displayName: 'Fable', gender: 'male', id: 'fable', language: 'multilingual' },
  { displayName: 'Nova', gender: 'female', id: 'nova', language: 'multilingual' },
  { displayName: 'Onyx', gender: 'male', id: 'onyx', language: 'multilingual' },
  { displayName: 'Sage', gender: 'female', id: 'sage', language: 'multilingual' },
  { displayName: 'Shimmer', gender: 'female', id: 'shimmer', language: 'multilingual' },
];

/** `ballad`, `verse`, `marin` and `cedar` are only available on the GPT-4o TTS family. */
export const openaiGpt4oTTSVoices: TTSVoice[] = (
  [
    ...OPENAI_TTS_1_VOICES,
    { displayName: 'Ballad', gender: 'male', id: 'ballad', language: 'multilingual' },
    { displayName: 'Cedar', gender: 'male', id: 'cedar', language: 'multilingual' },
    { displayName: 'Marin', gender: 'female', id: 'marin', language: 'multilingual' },
    { displayName: 'Verse', gender: 'male', id: 'verse', language: 'multilingual' },
  ] satisfies TTSVoice[]
).sort((a, b) => a.id.localeCompare(b.id));

export const openaiTTS1Voices: TTSVoice[] = OPENAI_TTS_1_VOICES;

export const openaiTTS1Schema: TTSModelParamsSchema = {
  format: { default: 'mp3', enum: [...TTS_AUDIO_FORMATS] },
  speed: { default: 1, max: 4, min: 0.25, step: 0.05 },
  voice: { default: 'alloy' },
};

/** GPT-4o mini TTS takes style `instructions` but ignores `speed`. */
export const openaiGpt4oMiniTTSSchema: TTSModelParamsSchema = {
  format: { default: 'mp3', enum: [...TTS_AUDIO_FORMATS] },
  instructions: { default: '' },
  voice: { default: 'alloy' },
};

/**
 * MiniMax Mandarin system voices suited to character voice-over.
 * @see https://platform.minimaxi.com/docs/faq/system-voice-id
 */
export const minimaxTTSVoices: TTSVoice[] = [
  { displayName: '少女', gender: 'female', id: 'female-shaonv', language: 'zh-CN' },
  { displayName: '御姐', gender: 'female', id: 'female-yujie', language: 'zh-CN' },
  { displayName: '成熟女性', gender: 'female', id: 'female-chengshu', language: 'zh-CN' },
  { displayName: '甜美女性', gender: 'female', id: 'female-tianmei', language: 'zh-CN' },
  { displayName: '青涩青年', gender: 'male', id: 'male-qn-qingse', language: 'zh-CN' },
  { displayName: '精英青年', gender: 'male', id: 'male-qn-jingying', language: 'zh-CN' },
  { displayName: '霸道青年', gender: 'male', id: 'male-qn-badao', language: 'zh-CN' },
  { displayName: '青年大学生', gender: 'male', id: 'male-qn-daxuesheng', language: 'zh-CN' },
  { displayName: '聪明男童', gender: 'male', id: 'clever_boy', language: 'zh-CN' },
  { displayName: '可爱男童', gender: 'male', id: 'cute_boy', language: 'zh-CN' },
  { displayName: '萌萌女童', gender: 'female', id: 'lovely_girl', language: 'zh-CN' },
  { displayName: '病娇弟弟', gender: 'male', id: 'bingjiao_didi', language: 'zh-CN' },
  { displayName: '俊朗男友', gender: 'male', id: 'junlang_nanyou', language: 'zh-CN' },
  { displayName: '纯真学弟', gender: 'male', id: 'chunzhen_xuedi', language: 'zh-CN' },
  { displayName: '冷淡学长', gender: 'male', id: 'lengdan_xiongzhang', language: 'zh-CN' },
  { displayName: '霸道少爷', gender: 'male', id: 'badao_shaoye', language: 'zh-CN' },
  { displayName: '甜心小玲', gender: 'female', id: 'tianxin_xiaoling', language: 'zh-CN' },
  { displayName: '俏皮萌妹', gender: 'female', id: 'qiaopi_mengmei', language: 'zh-CN' },
  { displayName: '妩媚御姐', gender: 'female', id: 'wumei_yujie', language: 'zh-CN' },
  { displayName: '嗲嗲学妹', gender: 'female', id: 'diadia_xuemei', language: 'zh-CN' },
  { displayName: '淡雅学姐', gender: 'female', id: 'danya_xuejie', language: 'zh-CN' },
  {
    displayName: '傲娇御姐',
    gender: 'female',
    id: 'Chinese (Mandarin)_Mature_Woman',
    language: 'zh-CN',
  },
  {
    displayName: '不羁青年',
    gender: 'male',
    id: 'Chinese (Mandarin)_Unrestrained_Young_Man',
    language: 'zh-CN',
  },
  {
    displayName: '温暖少女',
    gender: 'female',
    id: 'Chinese (Mandarin)_Warm_Girl',
    language: 'zh-CN',
  },
  {
    displayName: '温柔学姐',
    gender: 'female',
    id: 'Chinese (Mandarin)_Gentle_Senior',
    language: 'zh-CN',
  },
  {
    displayName: '嘴硬竹马',
    gender: 'male',
    id: 'Chinese (Mandarin)_Stubborn_Friend',
    language: 'zh-CN',
  },
  {
    displayName: '清脆少女',
    gender: 'female',
    id: 'Chinese (Mandarin)_Crisp_Girl',
    language: 'zh-CN',
  },
  {
    displayName: '清澈邻家弟弟',
    gender: 'male',
    id: 'Chinese (Mandarin)_Pure-hearted_Boy',
    language: 'zh-CN',
  },
  {
    displayName: '柔和少女',
    gender: 'female',
    id: 'Chinese (Mandarin)_Soft_Girl',
    language: 'zh-CN',
  },
  {
    displayName: '温润男声',
    gender: 'male',
    id: 'Chinese (Mandarin)_Gentleman',
    language: 'zh-CN',
  },
  {
    displayName: '新闻女声',
    gender: 'female',
    id: 'Chinese (Mandarin)_News_Anchor',
    language: 'zh-CN',
  },
  {
    displayName: '播报男声',
    gender: 'male',
    id: 'Chinese (Mandarin)_Male_Announcer',
    language: 'zh-CN',
  },
];

/** Emotions every MiniMax speech model accepts. */
const MINIMAX_BASE_EMOTIONS = [
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
  'calm',
];

/** `aac` is the only standard format t2a_v2 does not produce. */
const MINIMAX_TTS_FORMATS = TTS_AUDIO_FORMATS.filter((format) => format !== 'aac');

const createMiniMaxTTSSchema = (emotions: string[]): TTSModelParamsSchema => ({
  emotion: { default: 'calm', enum: emotions },
  format: { default: 'mp3', enum: MINIMAX_TTS_FORMATS },
  pitch: { default: 0, max: 12, min: -12, step: 1 },
  sampleRate: { default: 32_000, enum: [8000, 16_000, 22_050, 24_000, 32_000, 44_100] },
  speed: { default: 1, max: 2, min: 0.5, step: 0.05 },
  voice: { default: 'female-shaonv' },
  volume: { default: 1, max: 10, min: 0.1, step: 0.1 },
});

/** speech-2.8 adds `fluent` but drops `whisper`. */
export const minimaxSpeech28Schema = createMiniMaxTTSSchema([...MINIMAX_BASE_EMOTIONS, 'fluent']);

export const minimaxSpeech26Schema = createMiniMaxTTSSchema([
  ...MINIMAX_BASE_EMOTIONS,
  'fluent',
  'whisper',
]);

export const minimaxSpeech02Schema = createMiniMaxTTSSchema(MINIMAX_BASE_EMOTIONS);
