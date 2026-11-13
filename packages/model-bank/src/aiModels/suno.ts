import { sunoV6MusicSchema } from '../const/musicParameters';
import type { AIText2MusicModelCard } from '../types/aiModel';

// Each card is one Suno model version; the runtime sends the gateway's version name
// (`suno-v6` → `V6`). Older versions (V4 – V5_5) are deprecated upstream and not listed.
// Price: about $0.06 per request on Suno API gateways, which returns 2 songs.
// @see https://docs.sunoapi.org/suno-api/generate-music
const sunoMusicModels: AIText2MusicModelCard[] = [
  {
    description:
      'Suno V6: greater musical expression with more natural vocals and richer detail. Songs up to 6 minutes, lyrics up to 5,000 characters.',
    displayName: 'Suno V6',
    enabled: true,
    id: 'suno-v6',
    outputsPerRequest: 2,
    parameters: sunoV6MusicSchema,
    pricing: {
      units: [{ name: 'musicGeneration', rate: 0.03, strategy: 'fixed', unit: 'song' }],
    },
    type: 'text2music',
  },
  {
    description:
      'Suno V6 Wild: pushes creative boundaries for bolder, more distinctive musical expression.',
    displayName: 'Suno V6 Wild',
    enabled: true,
    id: 'suno-v6-wild',
    outputsPerRequest: 2,
    parameters: sunoV6MusicSchema,
    pricing: {
      units: [{ name: 'musicGeneration', rate: 0.03, strategy: 'fixed', unit: 'song' }],
    },
    type: 'text2music',
  },
  {
    description:
      'Suno V6 Mini: lightweight and fast, balancing quality and speed for quick drafts.',
    displayName: 'Suno V6 Mini',
    id: 'suno-v6-mini',
    outputsPerRequest: 2,
    parameters: sunoV6MusicSchema,
    pricing: {
      units: [{ name: 'musicGeneration', rate: 0.03, strategy: 'fixed', unit: 'song' }],
    },
    type: 'text2music',
  },
];

/**
 * Gateway model version for each Suno card id.
 */
export const SUNO_MODEL_VERSIONS: Record<string, string> = {
  'suno-v6': 'V6',
  'suno-v6-mini': 'V6_MINI',
  'suno-v6-wild': 'V6_WILD',
};

export const allModels = [...sunoMusicModels];

export default allModels;
