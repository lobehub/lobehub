/**
 * The model / provider catalog card types are owned by `model-bank` (the
 * package whose data files are typed by them) — re-exported here so existing
 * `@lobechat/types` / `@/types/llm` imports keep working.
 */
export type { ChatModelCard, ModelProviderCard } from 'model-bank';

export type LLMRoleType = 'user' | 'system' | 'assistant' | 'tool';

export interface LLMMessage {
  content: string;
  role: LLMRoleType;
}

export type FewShots = LLMMessage[];
