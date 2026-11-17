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
  // Offered by both the China and the global endpoint; most catalog ids are China-only.
  voice: { default: 'Chinese (Mandarin)_Warm_Girl' },
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

/**
 * ElevenLabs voices that every account keeps using after the legacy Default voices
 * (Rachel, George, Sarah, ...) expire on 2026-12-31. Each entry is the official
 * replacement for one Default voice; `gender` follows the voice it replaces. They are
 * Voice Library voices, so free-tier keys cannot call them through the API.
 * ElevenLabs voices speak every language the selected model supports.
 * @see https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-default-voices
 */
export const elevenlabsTTSVoices: TTSVoice[] = [
  /**
   * Default voice: a legacy Default (premade) voice, so free-tier keys can call it
   * through the API, unlike the Voice Library replacements below. ElevenLabs expires the
   * Default voices on 2026-12-31; switch the default to a replacement by then.
   */
  {
    description: 'Laid-back, casual, resonant',
    displayName: 'Roger',
    gender: 'male',
    id: 'CwhRBWXzGAHq8TQ4Fs17',
    language: 'multilingual',
  },
  {
    description: 'Warm, grounded storyteller',
    displayName: 'Darian',
    gender: 'male',
    id: 'gOupLcAkjEnguROwi4oS',
    language: 'multilingual',
  },
  {
    description: 'Warm, soft guide',
    displayName: 'Talia',
    gender: 'female',
    id: 'OZ0L6eISlOejga3XjDFt',
    language: 'multilingual',
  },
  {
    description: 'Crisp professional narrator',
    displayName: 'Elara',
    gender: 'female',
    id: 'WQP7cQUF5aAS6Axh5yaa',
    language: 'multilingual',
  },
  {
    description: 'Dry, calm Australian',
    displayName: 'Baxter',
    gender: 'male',
    id: 'jSuBIjxMKhqIfb0wCK1F',
    language: 'multilingual',
  },
  {
    description: 'Crisp British baritone',
    displayName: 'Eldrin',
    gender: 'male',
    id: '6WwXjDDEMyNmFG95zycZ',
    language: 'multilingual',
  },
  {
    description: 'Husky trickster',
    displayName: 'Callum',
    gender: 'male',
    id: 'fs2OqxduwXgp9foh2xjK',
    language: 'multilingual',
  },
  {
    description: 'Upbeat modern narrator',
    displayName: 'Elowen',
    gender: 'neutral',
    id: 'dvbL7qkNGZY1IqPGZAjM',
    language: 'multilingual',
  },
  {
    description: 'Amateur warrior',
    displayName: 'Kaelen',
    gender: 'male',
    id: '10NkTYmU7tSz3Kkl3Lex',
    language: 'multilingual',
  },
  {
    description: 'Bright and informative',
    displayName: 'Lawrence',
    gender: 'male',
    id: 'ktkP7Nsj67dw2zcplQYt',
    language: 'multilingual',
  },
  {
    description: 'Polished global anchor',
    displayName: 'Alicia',
    gender: 'female',
    id: 'BFd5oBc2DDna33pSi4Gf',
    language: 'multilingual',
  },
  {
    description: 'Friendly, casual neighbor',
    displayName: 'Maisie',
    gender: 'female',
    id: 'QtY3JBOUKEB5xzrRfOKc',
    language: 'multilingual',
  },
  {
    description: 'Effortless and cool',
    displayName: 'Warren',
    gender: 'male',
    id: '7QN34D2r3hCNwbOYIeK0',
    language: 'multilingual',
  },
  {
    description: 'Upbeat and natural',
    displayName: 'Jade',
    gender: 'female',
    id: 'g7LVvkPWALzPxOQbF6OE',
    language: 'multilingual',
  },
  {
    description: 'Natural and helpful',
    displayName: 'Eddie',
    gender: 'male',
    id: 'l7kNoIfnJKPg7779LI2t',
    language: 'multilingual',
  },
  {
    description: 'Trusted guide',
    displayName: 'Caleb',
    gender: 'male',
    id: 'AaOhDHYJ1XLZk74lXhdE',
    language: 'multilingual',
  },
  {
    description: 'Midnight storyteller',
    displayName: 'Sawyer',
    gender: 'male',
    id: '8dEUmyPMdDdK91vboYih',
    language: 'multilingual',
  },
  {
    description: 'Articulate anchor',
    displayName: 'Finley',
    gender: 'male',
    id: 'fnYMz3F5gMEDGMWcH1ex',
    language: 'multilingual',
  },
  {
    description: 'Atmospheric storyteller',
    displayName: 'Florence',
    gender: 'female',
    id: '22N9cF8z0o7y23njdyaY',
    language: 'multilingual',
  },
  {
    description: 'Seasoned mentor',
    displayName: 'Wyatt',
    gender: 'male',
    id: 'FrS6cKLB1wg4WYgPa9GW',
    language: 'multilingual',
  },
];

/**
 * `output_format` covers mp3, opus, pcm and wav (plus telephony ulaw/alaw); there is no
 * aac or flac output.
 * @see https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 */
const ELEVENLABS_TTS_FORMATS = TTS_AUDIO_FORMATS.filter(
  (format) => format !== 'aac' && format !== 'flac',
);

/**
 * Roger, a Default (premade) voice: callable on every plan for accounts created before
 * March 2026, until ElevenLabs retires the Default voices on 2026-12-31. The runtime falls
 * back to a voice from the account when this one is unavailable.
 */
export const ELEVENLABS_DEFAULT_VOICE_ID = 'CwhRBWXzGAHq8TQ4Fs17';

/** Voice ids in the built-in ElevenLabs catalog. */
export const ELEVENLABS_VOICE_IDS: ReadonlySet<string> = new Set(
  elevenlabsTTSVoices.map((voice) => voice.id),
);
const ELEVENLABS_DEFAULT_VOICE = ELEVENLABS_DEFAULT_VOICE_ID;

/** Multilingual v2 and the Flash / Turbo family take `voice_settings.speed` from 0.7 to 1.2. */
export const elevenlabsTTSSchema: TTSModelParamsSchema = {
  format: { default: 'mp3', enum: ELEVENLABS_TTS_FORMATS },
  speed: { default: 1, max: 1.2, min: 0.7, step: 0.05 },
  voice: { default: ELEVENLABS_DEFAULT_VOICE },
};

/** Eleven v3 and v4 have no speed setting. */
export const elevenlabsExpressiveTTSSchema: TTSModelParamsSchema = {
  format: { default: 'mp3', enum: ELEVENLABS_TTS_FORMATS },
  voice: { default: ELEVENLABS_DEFAULT_VOICE },
};

/**
 * Sentinel voice id: Fish Audio speaks with its default voice when a request carries no
 * `reference_id`, so the runtime omits the field for this id.
 * @see https://docs.fish.audio/developer-guide/getting-started/quickstart
 */
export const FISH_AUDIO_DEFAULT_VOICE_ID = 'default';

/**
 * Fish Audio publishes no catalog of voices it owns: the Voice Library is mostly
 * community uploads, including unlicensed character and real-person clones, so none of it
 * is bundled. The built-in entry is Fish Audio's own default voice; callers pass the
 * `reference_id` of a voice they cloned or are licensed to use as `voice`.
 */
export const fishAudioTTSVoices: TTSVoice[] = [
  {
    description: 'The voice Fish Audio uses when no reference voice is given',
    displayName: 'Fish Audio default',
    gender: 'neutral',
    id: FISH_AUDIO_DEFAULT_VOICE_ID,
    language: 'multilingual',
  },
];

/**
 * Sample rates `/v1/tts` accepts per format; omitted, each format uses its own default
 * (44.1 kHz, or 48 kHz for opus).
 * @see https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
 */
export const FISH_AUDIO_SAMPLE_RATES: Record<'mp3' | 'opus' | 'pcm' | 'wav', number[]> = {
  mp3: [32_000, 44_100],
  opus: [48_000],
  pcm: [8000, 16_000, 24_000, 32_000, 44_100],
  wav: [8000, 16_000, 24_000, 32_000, 44_100],
};

/** `format`: mp3, wav, pcm and opus; there is no aac or flac output. */
const FISH_AUDIO_TTS_FORMATS = TTS_AUDIO_FORMATS.filter(
  (format) => format !== 'aac' && format !== 'flac',
);

/**
 * Characters per Fish Audio request. The audio comes back in one inline response, so a
 * longer request would exceed the serverless response limit only after the synthesis was
 * billed. Enforced by the Fish Audio runtime and by the OpenAI-compatible path for gateway
 * routes (`fish-audio/*`), so routed aliases are capped too.
 */
export const FISH_AUDIO_MAX_INPUT_CHARACTERS = 4096;

/** Upper bound of the delivery direction placed in front of the text. */
export const FISH_AUDIO_MAX_INSTRUCTIONS_LENGTH = 200;

/** S1 takes `prosody.speed` from 0.5 to 2 but no bracketed delivery directions. */
export const fishAudioTTSSchema: TTSModelParamsSchema = {
  format: { default: 'mp3', enum: FISH_AUDIO_TTS_FORMATS },
  sampleRate: {
    default: 44_100,
    description: 'mp3: 32000 or 44100; opus: 48000; wav and pcm: 8000 to 44100',
    enum: [...new Set(Object.values(FISH_AUDIO_SAMPLE_RATES).flat())].sort((a, b) => a - b),
  },
  speed: { default: 1, max: 2, min: 0.5, step: 0.05 },
  voice: { default: FISH_AUDIO_DEFAULT_VOICE_ID },
};

/**
 * The S2 family and Drama 3 follow natural-language `[directions]` written into the text;
 * `instructions` is sent that way, in front of the input, and is billed with it.
 * @see https://docs.fish.audio/features/text-to-speech/drama-3
 */
export const fishAudioDirectedTTSSchema: TTSModelParamsSchema = {
  ...fishAudioTTSSchema,
  instructions: { default: '', maxLength: FISH_AUDIO_MAX_INSTRUCTIONS_LENGTH },
};

/**
 * Official Doubao Speech 2.0 voices (`*_uranus_bigtts`), which only the `seed-tts-2.0`
 * resource can speak. Voice clones (`S_*`) belong to the account and are passed by id.
 * @see https://www.volcengine.com/docs/6561/1257544
 */
export const doubaoSpeech20Voices: TTSVoice[] = [
  {
    description: 'Lively, multilingual',
    displayName: 'Vivi 2.0',
    gender: 'female',
    id: 'zh_female_vv_uranus_bigtts',
    language: 'multilingual',
  },
  {
    displayName: '小何 2.0',
    gender: 'female',
    id: 'zh_female_xiaohe_uranus_bigtts',
    language: 'zh-CN',
  },
  { displayName: '云舟 2.0', gender: 'male', id: 'zh_male_m191_uranus_bigtts', language: 'zh-CN' },
  {
    displayName: '小天 2.0',
    gender: 'male',
    id: 'zh_male_taocheng_uranus_bigtts',
    language: 'zh-CN',
  },
  {
    displayName: '团子 2.0',
    gender: 'female',
    id: 'zh_female_tuanzi_uranus_bigtts',
    language: 'zh-CN',
  },
  {
    displayName: '爽快思思 2.0',
    gender: 'female',
    id: 'zh_female_shuangkuaisisi_uranus_bigtts',
    language: 'zh-CN',
  },
  {
    displayName: '知性灿灿 2.0',
    gender: 'female',
    id: 'zh_female_cancan_uranus_bigtts',
    language: 'zh-CN',
  },
  {
    displayName: '清新女声 2.0',
    gender: 'female',
    id: 'zh_female_qingxinnvsheng_uranus_bigtts',
    language: 'zh-CN',
  },
  {
    displayName: '暖阳女声 2.0',
    gender: 'female',
    id: 'zh_female_kefunvsheng_uranus_bigtts',
    language: 'zh-CN',
  },
  {
    displayName: '深夜播客 2.0',
    gender: 'male',
    id: 'zh_male_shenyeboke_uranus_bigtts',
    language: 'zh-CN',
  },
  { displayName: 'Tim', gender: 'male', id: 'en_male_tim_uranus_bigtts', language: 'en-US' },
  {
    displayName: 'Dacey',
    gender: 'female',
    id: 'en_female_dacey_uranus_bigtts',
    language: 'en-US',
  },
  {
    displayName: 'Stokie',
    gender: 'female',
    id: 'en_female_stokie_uranus_bigtts',
    language: 'en-US',
  },
  { displayName: 'Alex', gender: 'male', id: 'en_male_alex_uranus_bigtts', language: 'en-US' },
  {
    displayName: 'Charlotte',
    gender: 'female',
    id: 'en_female_authoritative-british_uranus_bigtts',
    language: 'en-GB',
  },
  { displayName: 'Ryan', gender: 'male', id: 'en_male_ryan_uranus_bigtts', language: 'en-US' },
];

/** Vivi 2.0, the voice of the official Seed-TTS 2.0 examples. */
export const DOUBAO_SPEECH_DEFAULT_VOICE_ID = 'zh_female_vv_uranus_bigtts';

/** Voice ids in the built-in Doubao Speech catalog. */
export const DOUBAO_SPEECH_VOICE_IDS: ReadonlySet<string> = new Set(
  doubaoSpeech20Voices.map((voice) => voice.id),
);

/**
 * V3 `audio_params`: format mp3 / ogg_opus / pcm / wav (opus is always 48 kHz),
 * `speech_rate` and `loudness_rate` from -50 to 100 (0.5x to 2x), and
 * `post_process.pitch` from -12 to 12 semitones.
 * @see https://www.volcengine.com/docs/6561/2528925
 */
export const doubaoSpeechTTSSchema: TTSModelParamsSchema = {
  format: { default: 'mp3', enum: ['mp3', 'opus', 'wav', 'pcm'] },
  pitch: { default: 0, max: 12, min: -12, step: 1 },
  sampleRate: { default: 24_000, enum: [8000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000] },
  speed: { default: 1, max: 2, min: 0.5, step: 0.05 },
  voice: { default: DOUBAO_SPEECH_DEFAULT_VOICE_ID },
  volume: { default: 1, max: 2, min: 0.5, step: 0.05 },
};

/**
 * Gemini TTS prebuilt voices, shared by every Gemini TTS model. Descriptions are Google's
 * own one-word characterizations; genders follow the matching Chirp 3 HD voices.
 * @see https://ai.google.dev/gemini-api/docs/speech-generation#voices
 */
export const googleTTSVoices: TTSVoice[] = (
  [
    ['Achernar', 'female', 'Soft'],
    ['Achird', 'male', 'Friendly'],
    ['Algenib', 'male', 'Gravelly'],
    ['Algieba', 'male', 'Smooth'],
    ['Alnilam', 'male', 'Firm'],
    ['Aoede', 'female', 'Breezy'],
    ['Autonoe', 'female', 'Bright'],
    ['Callirrhoe', 'female', 'Easy-going'],
    ['Charon', 'male', 'Informative'],
    ['Despina', 'female', 'Smooth'],
    ['Enceladus', 'male', 'Breathy'],
    ['Erinome', 'female', 'Clear'],
    ['Fenrir', 'male', 'Excitable'],
    ['Gacrux', 'female', 'Mature'],
    ['Iapetus', 'male', 'Clear'],
    ['Kore', 'female', 'Firm'],
    ['Laomedeia', 'female', 'Upbeat'],
    ['Leda', 'female', 'Youthful'],
    ['Orus', 'male', 'Firm'],
    ['Puck', 'male', 'Upbeat'],
    ['Pulcherrima', 'female', 'Forward'],
    ['Rasalgethi', 'male', 'Informative'],
    ['Sadachbia', 'male', 'Lively'],
    ['Sadaltager', 'male', 'Knowledgeable'],
    ['Schedar', 'male', 'Even'],
    ['Sulafat', 'female', 'Warm'],
    ['Umbriel', 'male', 'Easy-going'],
    ['Vindemiatrix', 'female', 'Gentle'],
    ['Zephyr', 'female', 'Bright'],
    ['Zubenelgenubi', 'male', 'Casual'],
  ] as const
).map(([id, gender, description]) => ({
  description,
  displayName: id,
  gender,
  id,
  language: 'multilingual',
}));

/**
 * Gemini returns 16-bit PCM, which the runtime encodes to MP3 or wraps as WAV. Gemini has no
 * numeric speed, pitch or volume control: pace and tone come from the style `instructions`
 * (e.g. "speak slowly and calmly"), so only those are declared.
 */
export const googleTTSSchema: TTSModelParamsSchema = {
  format: { default: 'mp3', enum: ['mp3', 'wav', 'pcm'] },
  instructions: {
    default: '',
    description: 'Style, tone or pace, e.g. "speak slowly in a warm, calm voice"',
  },
  voice: { default: 'Kore' },
};
