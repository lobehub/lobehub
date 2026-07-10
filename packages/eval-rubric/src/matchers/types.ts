export interface GenerateObjectPayload {
  messages: { content: string; role: 'system' | 'user' }[];
  model: string;
  provider?: string;
  schema: Record<string, unknown>;
}

export interface MatchContext {
  generateObject?: (payload: GenerateObjectPayload) => Promise<{ reason: string; score: number }>;
  /** Max attempts for the LLM judge before giving up (transient flakes / missing score). Default 3. */
  judgeMaxAttempts?: number;
  judgeModel?: string;
}

export interface MatchResult {
  passed: boolean;
  reason?: string;
  score: number;
}
