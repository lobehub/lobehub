import type { AgentModel } from '@/database/models/agent';
import type { TaskModel } from '@/database/models/task';
import type { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

/**
 * What the `TaskService` sub-domain modules read from the service.
 *
 * Use when:
 * - A function under `task/` needs the caller scope or one of the models the
 *   service instance owns
 *
 * Expects:
 * - The service builds it on every call, so it always reflects the instance
 */
export interface TaskServiceDeps {
  agentModel: AgentModel;
  db: LobeChatDatabase;
  taskModel: TaskModel;
  taskTopicModel: TaskTopicModel;
  userId: string;
  workspaceId?: string;
}
