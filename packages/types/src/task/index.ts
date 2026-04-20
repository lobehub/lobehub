// ── Task type aliases ──

export type TaskStatus = 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';

export type TaskPriority = 0 | 1 | 2 | 3 | 4;

export type TaskActivityType = 'brief' | 'comment' | 'created' | 'topic';

// null = no automation
export type TaskAutomationMode = 'heartbeat' | 'schedule';

// ── Config types ──

export interface CheckpointConfig {
  onAgentRequest?: boolean;
  tasks?: {
    afterIds?: string[];
    beforeIds?: string[];
  };
  topic?: {
    after?: boolean;
    before?: boolean;
  };
}

export interface WorkspaceDocNode {
  charCount: number | null;
  createdAt: string;
  fileType: string;
  parentId: string | null;
  pinnedBy: string;
  sourceTaskIdentifier: string | null;
  title: string;
  updatedAt: string | null;
}

export interface WorkspaceTreeNode {
  children: WorkspaceTreeNode[];
  id: string;
}

export interface WorkspaceData {
  nodeMap: Record<string, WorkspaceDocNode>;
  tree: WorkspaceTreeNode[];
}

export interface TaskTopicHandoff {
  keyFindings?: string[];
  nextAction?: string;
  summary?: string;
  title?: string;
}

// ── Task list item (shared between router response and client) ──

export interface TaskParticipant {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string;
  type: 'user' | 'agent';
}

export interface TaskItem {
  accessedAt: Date;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  automationMode: TaskAutomationMode | null;
  completedAt: Date | null;
  config: unknown;
  context: unknown;
  createdAt: Date;
  createdByAgentId: string | null;
  createdByUserId: string;
  currentTopicId: string | null;
  description: string | null;
  error: string | null;
  heartbeatInterval: number | null;
  heartbeatTimeout: number | null;
  id: string;
  identifier: string;
  instruction: string;
  lastHeartbeatAt: Date | null;
  maxTopics: number | null;
  name: string | null;
  parentTaskId: string | null;
  priority: number | null;
  schedulePattern: string | null;
  scheduleTimezone: string | null;
  seq: number;
  sortOrder: number | null;
  startedAt: Date | null;
  status: string;
  totalTopics: number | null;
  updatedAt: Date;
}

export type TaskListItem = TaskItem & {
  participants: TaskParticipant[];
};

export interface NewTask {
  accessedAt?: Date;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  automationMode?: TaskAutomationMode | null;
  completedAt?: Date | null;
  config?: unknown;
  context?: unknown;
  createdAt?: Date;
  createdByAgentId?: string | null;
  createdByUserId: string;
  currentTopicId?: string | null;
  description?: string | null;
  error?: string | null;
  heartbeatInterval?: number | null;
  heartbeatTimeout?: number | null;
  id?: string;
  identifier: string;
  instruction: string;
  lastHeartbeatAt?: Date | null;
  maxTopics?: number | null;
  name?: string | null;
  parentTaskId?: string | null;
  priority?: number | null;
  schedulePattern?: string | null;
  scheduleTimezone?: string | null;
  seq: number;
  sortOrder?: number | null;
  startedAt?: Date | null;
  status?: string;
  totalTopics?: number | null;
  updatedAt?: Date;
}

// ── Task Detail (shared across CLI, viewTask tool, task.detail router) ──

export interface TaskDetailSubtaskAssignee {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string | null;
}

export interface TaskDetailSubtask {
  assignee?: TaskDetailSubtaskAssignee | null;
  blockedBy?: string;
  children?: TaskDetailSubtask[];
  identifier: string;
  name?: string | null;
  priority?: number | null;
  status: string;
}

export interface TaskDetailWorkspaceNode {
  children?: TaskDetailWorkspaceNode[];
  createdAt?: string;
  documentId: string;
  fileType?: string;
  size?: number | null;
  sourceTaskIdentifier?: string | null;
  title?: string;
}

export interface TaskDetailActivityAuthor {
  avatar?: string | null;
  id: string;
  name?: string | null;
  type: 'agent' | 'user';
}

export interface TaskDetailActivityAgent {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string | null;
}

export interface TaskDetailActivity {
  actions?: unknown;
  agentId?: string | null;
  agents?: TaskDetailActivityAgent[];
  artifacts?: unknown;
  author?: TaskDetailActivityAuthor;
  briefType?: string;
  content?: string;
  createdAt?: string;
  cronJobId?: string | null;
  id?: string;
  priority?: string | null;
  readAt?: string | null;
  resolvedAction?: string | null;
  resolvedAt?: string | null;
  resolvedComment?: string | null;
  seq?: number | null;
  status?: string | null;
  summary?: string;
  taskId?: string | null;
  time?: string;
  title?: string;
  topicId?: string | null;
  type: TaskActivityType;
  userId?: string | null;
}

export interface TaskDetailData {
  activities?: TaskDetailActivity[];
  agentId?: string | null;
  // null/undefined = no automation configured
  automationMode?: TaskAutomationMode | null;
  checkpoint?: CheckpointConfig;
  config?: Record<string, unknown>;
  createdAt?: string;
  dependencies?: Array<{ dependsOn: string; type: string }>;
  description?: string | null;
  error?: string | null;
  // heartbeat.interval: periodic execution interval | heartbeat.timeout+lastAt: watchdog monitoring (detects stuck tasks)
  heartbeat?: {
    interval?: number | null;
    lastAt?: string | null;
    timeout?: number | null;
  };
  identifier: string;
  instruction: string;
  name?: string | null;
  parent?: { identifier: string; name: string | null } | null;
  priority?: number | null;
  review?: Record<string, any> | null;
  status: string;
  subtasks?: TaskDetailSubtask[];
  topicCount?: number;
  userId?: string | null;
  workspace?: TaskDetailWorkspaceNode[];
}
