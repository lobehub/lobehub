import { describe, expect, it, vi } from 'vitest';

import { agentRenameField } from './useMoreMenu';

vi.mock('@/components/RenameModal', () => ({ openRenameModal: vi.fn() }));

describe('agentRenameField', () => {
  it('renames the personal name when the agent has one — that is what the header shows', () => {
    expect(agentRenameField({ name: 'Alice', title: 'Health Assistant' })).toBe('name');
  });

  it('renames the title when there is no name to show', () => {
    expect(agentRenameField({ name: null, title: 'Health Assistant' })).toBe('title');
    expect(agentRenameField({ title: 'Health Assistant' })).toBe('title');
  });

  it('treats a blank name as absent, like the label does', () => {
    expect(agentRenameField({ name: '   ', title: 'Health Assistant' })).toBe('title');
  });
});
