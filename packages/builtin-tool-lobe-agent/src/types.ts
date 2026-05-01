export const LobeAgentIdentifier = 'lobe-agent';

export const LobeAgentApiName = {
  analyzeVisualMedia: 'analyzeVisualMedia',
} as const;

export type LobeAgentApiNameType = (typeof LobeAgentApiName)[keyof typeof LobeAgentApiName];

export interface AnalyzeVisualMediaParams {
  files?: string[];
  imageRef?: string;
  question: string;
  videoRef?: string;
}
