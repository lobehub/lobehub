export const GOOGLE_AI_BLOCK_REASON = {
  BLOCKLIST: 'The content includes blocked terms. Please rephrase and try again.',
  IMAGE_SAFETY:
    'The generated image was blocked for safety reasons. Please try modifying your request.',
  LANGUAGE: "The requested language isn't supported. Please try again in a supported language.",
  OTHER: 'The content was blocked for an unknown reason. Please rephrase and try again.',
  PROHIBITED_CONTENT: 'The content may contain prohibited content. Please adjust it and try again.',
  RECITATION:
    'The content was blocked due to recitation risk. Please use more original wording and try again.',
  SAFETY: 'The content was blocked for safety reasons. Please adjust it and try again.',
  SPII: 'The content may include sensitive personal information (SPII). Please remove sensitive details and try again.',
  default: 'The content was blocked ({{blockReason}}). Please adjust it and try again.',
} as const;
