export interface GenerateObjectPayload {
  messages: { content: string; role: 'system' | 'user' }[];
  model: string;
  provider?: string;
  schema: Record<string, unknown>;
}

export interface MatchContext {
  generateObject?: (payload: GenerateObjectPayload) => Promise<{ reason: string; score: number }>;
  judgeModel?: string;
}

export interface MatchResult {
  passed: boolean;
  reason?: string;
  score: number;
}
