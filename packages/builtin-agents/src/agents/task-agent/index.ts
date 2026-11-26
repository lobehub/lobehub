import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRoleTemplate } from './systemRole';

export const TASK_AGENT: BuiltinAgentDefinition = {
  avatar: DEFAULT_INBOX_AVATAR,
  // No persisted model: the agent follows the account default model (see mergeAgentDefaultConfig).
  runtime: (ctx) => ({
    plugins: [TaskIdentifier, ...(ctx.plugins || [])],
    systemRole: systemRoleTemplate,
  }),
  slug: BUILTIN_AGENT_SLUGS.taskAgent,
};
