export interface Translate {
  from?: string;
  to: string;
}

export interface ChatTranslate extends Translate {
  content?: string;
}
