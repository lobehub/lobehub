export interface ChatGroupConfig {
  allowDM?: boolean;
  forkedFromIdentifier?: string;
  openingMessage?: string;
  openingQuestions?: string[];
  personal?: boolean;
  revealDM?: boolean;
  systemPrompt?: string;
}
