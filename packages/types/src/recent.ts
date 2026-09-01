import type { TaskStatus } from './task';
import type { ChatTopicMetadata } from './topic';

export interface RecentItem {
  agentId?: string | null;
  description?: string | null;
  icon: string;
  id: string;
  lastAssistantMessage?: string | null;
  metadata?: ChatTopicMetadata;
  routePath: string;
  /** Task lifecycle status when `type === 'task'`; null for topic/document. */
  status: TaskStatus | null;
  title: string;
  type: 'topic' | 'document' | 'task';
  updatedAt: Date;
  /** The member who owns this item — for author attribution in workspace team views. */
  userId?: string;
}
