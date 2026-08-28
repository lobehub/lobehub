import { describe, expect, it } from 'vitest';

import { isCollaborativeBuiltinAgentRow } from './collaborative';
import { BUILTIN_AGENT_SLUGS } from './types';

const builder = {
  slug: BUILTIN_AGENT_SLUGS.groupAgentBuilder,
  virtual: true,
  workspaceId: 'workspace-1',
};

describe('isCollaborativeBuiltinAgentRow', () => {
  it('matches a provisioned workspace builtin', () => {
    expect(isCollaborativeBuiltinAgentRow(builder)).toBe(true);
  });

  it('rejects the personal copy of the same builtin', () => {
    expect(isCollaborativeBuiltinAgentRow({ ...builder, workspaceId: null })).toBe(false);
  });

  it('rejects a legacy row that merely holds a reserved slug', () => {
    expect(isCollaborativeBuiltinAgentRow({ ...builder, virtual: false })).toBe(false);
  });

  it('rejects a builtin members are not meant to configure together', () => {
    expect(
      isCollaborativeBuiltinAgentRow({ ...builder, slug: BUILTIN_AGENT_SLUGS.taskAgent }),
    ).toBe(false);
  });

  it('rejects an ordinary agent', () => {
    expect(isCollaborativeBuiltinAgentRow({ slug: null, workspaceId: 'workspace-1' })).toBe(false);
  });
});
