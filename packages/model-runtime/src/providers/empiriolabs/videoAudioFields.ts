// Generated from the public EmpirioLabs AI model catalog:
// https://api.empiriolabs.ai/v1/models

/**
 * The request field each video model reads for its audio switch. A model that
 * is not listed reads `generate_audio`.
 */
export const videoAudioFields: Record<string, string> = {
  'kling-o3': 'sound',
  'kling-v3': 'sound',
  'pixverse-c1': 'generate_audio_switch',
  'pixverse-v5-6': 'audio',
  'pixverse-v6': 'generate_audio_switch',
  'pixverse-v6-max': 'generate_audio_switch',
  'wan-2-6': 'audio',
  'wan-3-0': 'audio',
};
