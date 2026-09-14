import { TaskIdentifier } from '@lobechat/builtin-tool-task';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRole } from './systemRole';

/**
 * Converts actionable Inbox evidence into issue or lightweight PRD proposals.
 *
 * Use when:
 * - A capture contains a reproducible defect, product request, or delivery task.
 * - Linear and Task candidates should be reviewed before creation.
 *
 * Expects:
 * - Source evidence plus optional intake routing context.
 *
 * Returns:
 * - Candidate issues and PRD fragments without external writes by default.
 */
export const ISSUE_PRD: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  runtime: (ctx) => ({
    plugins: [TaskIdentifier, 'linear', ...(ctx.plugins || [])],
    systemRole,
  }),
  slug: BUILTIN_AGENT_SLUGS.issuePrd,
};
