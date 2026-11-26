import { describe, expect, it } from 'vitest';

import type { AgentState, DiscoveredAgentFiles } from '../types/state';
import {
  applyAgentFileDiscovery,
  createAgentFileBatchSeen,
  mergeDiscoveredAgentFiles,
  type PendingAgentFileDiscovery,
  persistAgentFileDiscoveries,
} from './discoveredAgentFiles';

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

describe('applyAgentFileDiscovery', () => {
  const pending = (overrides: Partial<PendingAgentFileDiscovery> = {}) => ({
    deviceId: 'device-a',
    dirs: ['/repo/web'],
    instructions: [{ content: 'Use pnpm.', path: '/repo/web/AGENTS.md', source: 'AGENTS.md' }],
    skills: [{ description: 'Web', location: '/repo/web/SKILL.md', name: 'web' }],
    ...overrides,
  });
  const result = (overrides: Record<string, unknown> = {}) => ({
    content: 'file body',
    state: { agentFileDiscovery: pending(), lines: 1 },
    success: true,
    ...overrides,
  });

  it('leads the content with the instructions and records paths only', () => {
    const applied = applyAgentFileDiscovery(result(), {
      seen: createAgentFileBatchSeen(),
      skillsToolAvailable: true,
    });

    expect(applied.content).toBe(
      [
        '<agent_files_discovered>',
        'This directory has agent files the run had not loaded yet. Follow these instructions for work under their directory, together with the ones you started with; the more specific file wins where they disagree.',
        '<project_instructions source="AGENTS.md" path="/repo/web/AGENTS.md">\nUse pnpm.\n</project_instructions>',
        'Skills available under this directory (load one with activateSkill by name, or read its SKILL.md):',
        '- web: Web (/repo/web/SKILL.md)',
        '</agent_files_discovered>',
        '',
        'file body',
      ].join('\n'),
    );
    expect(applied.state).toEqual({
      agentFileDiscovery: {
        deviceId: 'device-a',
        dirs: ['/repo/web'],
        instructionPaths: ['/repo/web/AGENTS.md'],
        skills: [{ description: 'Web', location: '/repo/web/SKILL.md', name: 'web' }],
      },
      lines: 1,
    });
  });

  it('shows a file once per batch, but still records the second call’s directories', () => {
    const seen = createAgentFileBatchSeen();
    applyAgentFileDiscovery(result(), { seen, skillsToolAvailable: true });
    const second = applyAgentFileDiscovery(result(), { seen, skillsToolAvailable: true });

    expect(second.content).toBe('file body');
    expect(second.state.agentFileDiscovery).toEqual({
      deviceId: 'device-a',
      dirs: ['/repo/web'],
      instructionPaths: [],
      skills: [],
    });
  });

  it('claims nothing for a failed or blocked call', () => {
    const seen = createAgentFileBatchSeen();
    const failed = applyAgentFileDiscovery(result({ success: false }), {
      seen,
      skillsToolAvailable: true,
    });
    const blocked = applyAgentFileDiscovery(result(), {
      blocked: true,
      seen,
      skillsToolAvailable: true,
    });

    expect(failed.state).toEqual({ lines: 1 });
    expect(blocked.content).toBe('file body');
    expect(seen.instructionPaths.size).toBe(0);
  });

  it('keeps the nearest file whole when a parent file exceeds the budget', () => {
    const applied = applyAgentFileDiscovery(
      result({
        state: {
          agentFileDiscovery: pending({
            instructions: [
              { content: 'r'.repeat(40_000), path: '/repo/web/AGENTS.md', source: 'AGENTS.md' },
              { content: 'Nearest.', path: '/repo/web/src/AGENTS.md', source: 'AGENTS.md' },
            ],
            skills: [],
          }),
        },
      }),
      { seen: createAgentFileBatchSeen(), skillsToolAvailable: true },
    );

    expect(applied.content).toContain('Nearest.\n</project_instructions>');
    expect(applied.content).toContain(
      '[Truncated to fit this tool result. Read /repo/web/AGENTS.md for the rest.]',
    );
  });

  it('leaves a result without a discovery untouched', () => {
    const plain = { content: 'x', state: { lines: 1 }, success: true };
    expect(
      applyAgentFileDiscovery(plain, {
        seen: createAgentFileBatchSeen(),
        skillsToolAvailable: true,
      }),
    ).toBe(plain);
  });
});
