import { describe, expect, it } from 'vitest';

import { resolveRunAgentFiles, resolveRunProjectSkills } from '../resolveRunProjectSkills';

const plan = {
  skills: {
    enabledPluginIds: [],
    skills: [
      {
        description: 'Root',
        identifier: 'project:root',
        location: '/r/SKILL.md',
        name: 'root',
        source: 'project',
      },
      { description: 'Builtin', identifier: 'lobehub', name: 'lobehub', source: 'builtin' },
    ],
  },
};
const discovered = {
  deviceId: 'device-a',
  dirs: ['/home/u/repos/admin'],
  instructionPaths: ['/home/u/repos/admin/AGENTS.md'],
  skills: [
    {
      description: 'Admin',
      location: '/home/u/repos/admin/.agents/skills/a/SKILL.md',
      name: 'admin',
    },
    { description: 'Shadow', location: '/x/SKILL.md', name: 'ROOT' },
  ],
};

describe('resolveRunProjectSkills', () => {
  it('adds skills discovered on the active device after the start-of-run ones', () => {
    expect(resolveRunProjectSkills(plan, discovered, 'device-a')).toEqual([
      { description: 'Root', location: '/r/SKILL.md', name: 'root', source: 'project' },
      {
        description: 'Admin',
        location: '/home/u/repos/admin/.agents/skills/a/SKILL.md',
        name: 'admin',
        source: 'project',
      },
    ]);
  });

  it('ignores a discovery recorded on another device', () => {
    expect(resolveRunProjectSkills(plan, discovered, 'device-b')).toHaveLength(1);
  });
});

describe('resolveRunAgentFiles', () => {
  it('combines the start-of-run scan with mid-run discoveries', () => {
    const state = {
      binding: { device: { id: 'device-a', systemInfo: { workingDirectory: '/home/u/repo/app' } } },
      discoveredAgentFiles: discovered,
      plan,
      world: {
        projectInstructions: [
          { content: 'root', path: '/home/u/repo/AGENTS.md', source: 'AGENTS.md' },
          { content: 'legacy', source: 'AGENTS.md' },
        ],
      },
    } as any;

    expect(resolveRunAgentFiles(state, 'device-a')).toEqual({
      deviceId: 'device-a',
      instructionPaths: ['/home/u/repo/AGENTS.md', '/home/u/repos/admin/AGENTS.md'],
      knownDirs: ['/home/u/repo/app', '/home/u/repo', '/home/u/repos/admin'],
      skillNames: ['root', 'lobehub', 'admin', 'ROOT'],
    });
  });

  it('is absent without an active device', () => {
    expect(resolveRunAgentFiles({} as any, undefined)).toBeUndefined();
  });
});
