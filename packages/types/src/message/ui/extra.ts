import { ChatTranslate } from '../common';

export interface ChatTTS {
  contentMd5?: string;
  file?: string;
  voice?: string;
}

export interface ChatMessageExtra {
  fromModel?: string;
  fromProvider?: string;
  // 翻译
  translate?: ChatTranslate | false | null;
  // TTS
  tts?: ChatTTS;
}
