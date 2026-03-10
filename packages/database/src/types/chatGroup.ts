export interface ChatGroupConfig {
  allowDM?: boolean;
  forkedFromIdentifier?: string;
  openingMessage?: string;
  openingQuestions?: string[];
  revealDM?: boolean;
  systemPrompt?: string;
}
