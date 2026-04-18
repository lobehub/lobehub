import { type BriefAction, type BriefType } from '@lobechat/types';

export interface AgentAvatarInfo {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string | null;
}

export interface BriefItem {
  actions: BriefAction[] | null;
  agentId: string | null;
  agents: AgentAvatarInfo[];
  artifacts: unknown;
  createdAt: Date | string;
  cronJobId: string | null;
  id: string;
  priority: string | null;
  readAt: Date | string | null;
  resolvedAction: string | null;
  resolvedAt: Date | string | null;
  resolvedComment: string | null;
  summary: string;
  taskId: string | null;
  title: string;
  topicId: string | null;
  type: BriefType;
  userId: string;
}
