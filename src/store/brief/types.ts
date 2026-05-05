import {
  type BriefAction,
  type BriefArtifacts,
  type BriefType,
  type TaskStatus,
} from '@lobechat/types';

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
  artifacts: BriefArtifacts | null;
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
  /** Parent task's runtime status — `scheduled` means the task is parked between automated runs and approving the brief should NOT complete it. Populated by server enrichment; optional on locally-constructed BriefItems (e.g. from activity rows). */
  taskStatus?: TaskStatus | null;
  title: string;
  topicId: string | null;
  type: BriefType;
  userId: string;
}
