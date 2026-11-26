import { describe, expect, it } from 'vitest';

import type { AgentState, DiscoveredAgentFiles } from '../types/state';
import { mergeDiscoveredAgentFiles, persistAgentFileDiscoveries } from './discoveredAgentFiles';

const discovery = (overrides: Partial<DiscoveredAgentFiles> = {}): DiscoveredAgentFiles => ({
  deviceId: 'device-a',
  dirs: ['/repo/admin'],
  instructionPaths: ['/repo/admin/AGENTS.md'],
  skills: [{ description: 'Admin', location: '/repo/admin/.agents/skills/a/SKILL.md', name: 'a' }],
  ...overrides,
});

describe('mergeDiscoveredAgentFiles', () => {
  it('unions directories, instruction paths and skills by name', () => {
    const merged = mergeDiscoveredAgentFiles(
      discovery(),
      discovery({
        dirs: ['/repo/admin', '/repo/web'],
        instructionPaths: ['/repo/web/AGENTS.md'],
        skills: [
          { description: 'Dup', location: '/repo/web/.agents/skills/a/SKILL.md', name: 'A' },
          { description: 'Web', location: '/repo/web/.agents/skills/b/SKILL.md', name: 'b' },
        ],
      }),
    );

    expect(merged).toEqual({
      deviceId: 'device-a',
      dirs: ['/repo/admin', '/repo/web'],
      instructionPaths: ['/repo/admin/AGENTS.md', '/repo/web/AGENTS.md'],
      skills: [
        { description: 'Admin', location: '/repo/admin/.agents/skills/a/SKILL.md', name: 'a' },
        { description: 'Web', location: '/repo/web/.agents/skills/b/SKILL.md', name: 'b' },
      ],
    });
  });

  it('starts over for a discovery on another device', () => {
    const next = discovery({ deviceId: 'device-b', dirs: ['/other'] });
    expect(mergeDiscoveredAgentFiles(discovery(), next)).toBe(next);
  });
});

describe('persistAgentFileDiscoveries', () => {
  it('records discoveries from tool result states and ignores other states', () => {
    const state = {} as AgentState;

    persistAgentFileDiscoveries(state, [
      undefined,
      { lines: 3 },
      { agentFileDiscovery: { deviceId: 'x' } },
      { agentFileDiscovery: discovery() },
    ]);

    expect(state.discoveredAgentFiles).toEqual(discovery());
  });
});
