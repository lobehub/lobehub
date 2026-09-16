import type { BuiltinToolManifest } from '@lobechat/types';

export const GoalSupervisorIdentifier = 'lobe-goal-supervisor';
export const GoalSupervisorApiName = {
  inspectGoal: 'inspectGoal',
  inspectTask: 'inspectTask',
  readArtifact: 'readArtifact',
  resolveInterruption: 'resolveInterruption',
} as const;

export interface SupervisorScopeParams {
  goalId: string;
  incidentId: string;
}
export interface ResolveInterruptionParams extends SupervisorScopeParams {
  action: 'retry' | 'escalate';
  instruction: string;
  reason: string;
}

const scope = {
  goalId: { type: 'string' },
  incidentId: { type: 'string' },
};
export const GoalSupervisorManifest: BuiltinToolManifest = {
  identifier: GoalSupervisorIdentifier,
  type: 'builtin',
  meta: {
    avatar: '🎯',
    title: 'Goal supervision',
    description: 'Inspect and recover the assigned Goal interruption',
  },
  systemRole:
    'Inspect the Goal and Task before resolving an interruption. Read linked artifacts when their contents matter. References alone do not prove a checkpoint exists. Only resolveInterruption submits an action; a prose answer does not. Never claim success merely because recovery was queued.',
  api: [
    {
      name: GoalSupervisorApiName.inspectGoal,
      description:
        'Read the assigned Goal graph, pending decisions, limits and version references. This grants no authority to change acceptance or budgets.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: scope,
        required: ['goalId', 'incidentId'],
      },
    },
    {
      name: GoalSupervisorApiName.inspectTask,
      description:
        'Read the interrupted Task contract, recent attempts, failure and saved handoffs. A handoff is reported evidence, not a filesystem probe.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: scope,
        required: ['goalId', 'incidentId'],
      },
    },
    {
      name: GoalSupervisorApiName.readArtifact,
      description:
        'Read a Work version linked to this Goal. Documents return current text explicitly labelled as current, not a historical snapshot. File references are not downloaded or verified by this tool. Missing content is reported explicitly.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { ...scope, workVersionId: { type: 'string' } },
        required: ['goalId', 'incidentId', 'workVersionId'],
      },
    },
    {
      name: GoalSupervisorApiName.resolveInterruption,
      description:
        'Submit an idempotent recovery request after inspection. retry queues the SAME Task under its original contract after server authority/budget checks; escalate opens the existing user decision path. Do not repeat completed computation. The coordinator applies the request after this supervisor run finishes.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...scope,
          action: { type: 'string', enum: ['retry', 'escalate'] },
          instruction: { type: 'string', minLength: 1, maxLength: 4000 },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
        },
        required: ['goalId', 'incidentId', 'action', 'instruction', 'reason'],
      },
    },
  ],
};
