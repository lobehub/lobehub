import { Doubao, ElevenLabs, FishAudio, modelMappings, providerMappings } from '@lobehub/icons';

/**
 * Brands @lobehub/icons ships artwork for but does not map to an id yet (checked against
 * 6.15.0). `ProviderIcon`, `ProviderCombine` and `ModelIcon` all look ids up in these
 * shared tables, so appending here covers every surface. Each entry names an id it must
 * resolve and is skipped once the package maps that id itself.
 */
const LOCAL_PROVIDER_MAPPINGS = [
  { Icon: ElevenLabs, keywords: ['elevenlabs'], probe: 'elevenlabs' },
  { Icon: FishAudio, keywords: ['fishaudio'], probe: 'fishaudio' },
  // Doubao Speech is Volcengine's speech service; its models are Doubao's.
  { Icon: Doubao, keywords: ['doubaospeech'], probe: 'doubaospeech' },
];

/** `ModelIcon` tests each keyword as a case-insensitive regex against the model id. */
const LOCAL_MODEL_MAPPINGS = [
  { Icon: ElevenLabs, keywords: ['^eleven_'], probe: 'eleven_multilingual_v2' },
  { Icon: FishAudio, keywords: ['^s2(\\.1)?-pro', '^drama-\\d', '^s1$'], probe: 's2.1-pro' },
  // The package's OpenAI `tts-` keyword would claim these ids otherwise.
  { Icon: Doubao, keywords: ['^seed-(tts|icl)-'], probe: 'seed-tts-2.0' },
];

let registered = false;

export const registerLocalIconMappings = () => {
  if (registered) return;
  registered = true;

  for (const { probe, ...mapping } of LOCAL_PROVIDER_MAPPINGS) {
    const mapped = providerMappings.some((item) =>
      item.keywords.some((keyword) => keyword.toLowerCase() === probe),
    );
    if (!mapped) providerMappings.push(mapping);
  }

  // `ModelIcon` takes the first matching entry, so a model id another brand's broad keyword
  // already claims (e.g. OpenAI's `tts-`) needs its entry in front of that one.
  for (const { probe, ...mapping } of LOCAL_MODEL_MAPPINGS) {
    const match = modelMappings.find((item) =>
      item.keywords.some((keyword) => new RegExp(keyword, 'i').test(probe)),
    );
    if (!match) modelMappings.push(mapping);
    else if (match.Icon !== mapping.Icon) modelMappings.unshift(mapping);
  }
};
