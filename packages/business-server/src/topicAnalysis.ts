import type { LobeChatDatabase } from '@lobechat/database';
import type { TopicAnalysisResult } from '@lobechat/types';

export interface AnalyzeTopicParams {
  db: LobeChatDatabase;
  /** Model and provider the user assigned to the topic auto summary. */
  model: string;
  provider: string;
  topicId: string;
  /** The same user / assistant transcript the summary was generated from. */
  transcript: string;
  userId: string;
  workspaceId?: string;
}

export const isTopicAnalysisEnabled = () => false;

/** Returns `null` when there is nothing to record for this topic. */
export const analyzeTopic = async (
  _params: AnalyzeTopicParams,
): Promise<TopicAnalysisResult | null> => null;
