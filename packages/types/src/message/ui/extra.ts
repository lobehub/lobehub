import type { ChatTranslate } from '../common';

export interface ChatTTS {
  contentMd5?: string;
  file?: string;
  voice?: string;
}

export interface ChatMessageExtra {
  model?: string;
  provider?: string;
  // Translation
  translate?: ChatTranslate | false | null;
  // Text-to-Speech
  tts?: ChatTTS;
}
