import type { BuiltinSkillManifest } from '@lobechat/types';

export const TaskIdentifier = 'task';

export const TaskManifest: BuiltinSkillManifest = {
  avatar: '📋',
  description: 'Task management and execution — create, track, review, and complete tasks via CLI.',
  identifier: TaskIdentifier,
  name: 'task',
  source: 'builtin',
};
