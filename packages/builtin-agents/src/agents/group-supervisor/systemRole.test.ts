import { systemPrompt as groupManagementSystemPrompt } from '@lobechat/builtin-tool-group-management';
import { describe, expect, it } from 'vitest';

import { supervisorSystemRole } from './systemRole';

describe('group supervisor prompts', () => {
  it.each([supervisorSystemRole, groupManagementSystemPrompt])(
    'keeps the supervisor role internal',
    (prompt) => {
      expect(prompt).not.toContain('You are a Group Supervisor');
      expect(prompt).toContain('"Supervisor" is an internal');
      expect(prompt).toContain('Never introduce or refer to yourself as Supervisor');
    },
  );
});
