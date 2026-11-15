import { z } from 'zod';

export const VOICE_AGENT_NAME = 'lobehub-voice';
export const VOICE_TURN_METHOD = 'lobehub.voice.turn';
export const VOICE_CANCEL_METHOD = 'lobehub.voice.cancel';
export const VOICE_RESULT_TOPIC = 'lobehub.voice.result';
export const VOICE_TURN_TIMEOUT_MS = 180_000;

export const voiceTurnSchema = z.object({
  requestId: z.uuid(),
  text: z.string().trim().min(1).max(4000),
});
export const voiceCancelSchema = voiceTurnSchema.pick({ requestId: true });
export const voiceResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), requestId: z.uuid(), text: z.string().min(1).max(100_000) }),
  z.object({ ok: z.literal(false), requestId: z.uuid() }),
]);
/** Personal media preferences; models and credentials remain in LobeHub. */
export const conversationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['voice', 'video']).default('voice'),
  tts: z
    .object({ provider: z.string().max(128), model: z.string().max(128) })
    .default({ provider: '', model: '' }),
  voice: z.string().trim().max(256).default(''),
  language: z.string().max(16).default('en'),
  silenceMs: z.number().int().min(300).max(3000).default(700),
});
export type ConversationConfig = z.infer<typeof conversationConfigSchema>;
export const livekitConnectionSchema = z.object({
  url: z.url({ protocol: /^wss?$/ }).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  }, 'Use a WebSocket server URL without credentials, query, or fragment'),
  apiKey: z.string().trim().min(1).max(256),
  apiSecret: z.string().min(1).max(4096),
});
export type LivekitConnection = z.infer<typeof livekitConnectionSchema>;
export const voiceJobSchema = z.object({
  participantIdentity: z.string().min(1),
  config: conversationConfigSchema.pick({ language: true, silenceMs: true }),
});
export const SPEECH_REQUEST_TOPIC = 'lobehub.conversation.speech.request';
export const SPEECH_RESPONSE_TOPIC = 'lobehub.conversation.speech.response';
export const MAX_SPEECH_PAYLOAD = 4_300_000;
export const speechRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    requestId: z.uuid(),
    kind: z.literal('asr'),
    audioBase64: z.string().min(1).max(4_194_304),
  }),
  z.object({ requestId: z.uuid(), kind: z.literal('tts'), text: z.string().min(1).max(4096) }),
]);
export const speechResponseSchema = z.object({
  requestId: z.uuid(),
  ok: z.boolean(),
  text: z.string().max(100_000).optional(),
  audioBase64: z.string().max(16_000_000).optional(),
  format: z.enum(['mp3', 'opus', 'aac']).optional(),
});
export type SpeechRequest = z.infer<typeof speechRequestSchema>;
export type SpeechResponse = z.infer<typeof speechResponseSchema>;
export type VoiceTurn = z.infer<typeof voiceTurnSchema>;
export type VoiceResult = z.infer<typeof voiceResultSchema>;
