import type { TaskDetailActivity } from '@lobechat/types';

type AssignmentVerbKey =
  | 'taskDetail.activities.assignment.agentAssigned'
  | 'taskDetail.activities.assignment.agentUnassigned'
  | 'taskDetail.activities.assignment.memberAssigned'
  | 'taskDetail.activities.assignment.memberUnassigned';

type DeletedTargetKey =
  | 'taskDetail.activities.assignment.deletedAgent'
  | 'taskDetail.activities.assignment.deletedMember';

export interface AssignmentActivityCopy {
  /** Name shown when the target id no longer resolves to a live member/agent. */
  deletedTargetKey: DeletedTargetKey;
  /**
   * Name for the actor slot when nobody is recorded — the runner assigning its
   * fallback inbox agent so an unassigned task can execute at all. Without it
   * the row reads as a headless "set the agent to …".
   */
  systemActorKey: 'taskDetail.activities.assignment.systemActor';
  /** What the actor did — reads as "<actor> <verb> <target>". */
  verbKey: AssignmentVerbKey;
}

/**
 * Pick the copy for one assignment row.
 *
 * Two independent axes decide the wording — which slot moved (agent vs member)
 * and whether it landed on someone or was cleared — so keeping the choice here
 * lets it be asserted without rendering the feed.
 */
export const resolveAssignmentActivityCopy = (
  assignment: TaskDetailActivity['assignment'],
): AssignmentActivityCopy => {
  const isAgentSlot = assignment?.kind === 'agent';
  const assigned = Boolean(assignment?.to);

  return {
    systemActorKey: 'taskDetail.activities.assignment.systemActor',
    deletedTargetKey: isAgentSlot
      ? 'taskDetail.activities.assignment.deletedAgent'
      : 'taskDetail.activities.assignment.deletedMember',
    verbKey: isAgentSlot
      ? assigned
        ? 'taskDetail.activities.assignment.agentAssigned'
        : 'taskDetail.activities.assignment.agentUnassigned'
      : assigned
        ? 'taskDetail.activities.assignment.memberAssigned'
        : 'taskDetail.activities.assignment.memberUnassigned',
  };
};
