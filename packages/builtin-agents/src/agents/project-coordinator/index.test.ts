import { describe, expect, it } from 'vitest';

import { createProjectCoordinatorAgentConfig } from './index';

describe('createProjectCoordinatorAgentConfig', () => {
  it('builds the default project coordinator config', () => {
    expect(
      createProjectCoordinatorAgentConfig({
        avatar: 'avatar.png',
        description: 'Ship the next release',
        identifier: 'LOBE',
        name: 'LobeHub',
      }),
    ).toEqual({
      avatar: 'avatar.png',
      description: 'Coordinates the LobeHub project',
      systemRole: [
        'You are the coordinator agent of a project.',
        'The current project, its member agents, linked knowledge bases and open tasks are provided with each message; rely on them over anything you remember.',
        'Help the user resume work, turn intent into concrete tasks and goals, use project resources, and coordinate project agents.',
      ].join('\n'),
      title: 'LobeHub Coordinator',
    });
  });

  it('keeps project facts out of the systemRole so a rename never leaves it stale', () => {
    const config = createProjectCoordinatorAgentConfig({
      description: 'Ship the next release',
      identifier: 'LOBE',
      name: 'LobeHub',
    });

    expect(config.systemRole).not.toContain('LobeHub');
    expect(config.systemRole).not.toContain('Ship the next release');
  });

  it('builds the config for a project without an identifier', () => {
    const config = createProjectCoordinatorAgentConfig({ name: 'LobeHub' });

    expect(config.title).toBe('LobeHub Coordinator');
  });
});
