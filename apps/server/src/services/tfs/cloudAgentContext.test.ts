import { describe, expect, it } from 'vitest';

import { buildTfsCloudAgentContext, usesTfsCloudAgentContext } from './cloudAgentContext';

describe('DevOps cloud CLI instructions', () => {
  it('selects DevOps instructions only for TFS-only initialization', () => {
    const tfs = { url: 'https://dev.example.com/C/P/_git/R' };
    const github = { url: 'https://github.com/o/r' };
    expect(usesTfsCloudAgentContext([tfs], [])).toBe(true);
    expect(usesTfsCloudAgentContext([github], [])).toBe(false);
    expect(usesTfsCloudAgentContext([tfs, github], [])).toBe(false);
    expect(usesTfsCloudAgentContext([tfs], ['o/r'])).toBe(false);
    expect(usesTfsCloudAgentContext([], [])).toBe(false);
    expect(usesTfsCloudAgentContext(undefined, [])).toBe(false);
  });
  it('carries repositories and recovery history without a GitHub pre-clone claim', () => {
    const context = buildTfsCloudAgentContext({
      agentSystemContext: '<tfs_repositories>https://dev.example.com/C/P/_git/R</tfs_repositories>',
      conversationHistory: [{ role: 'user', content: 'continue fixing' }],
      repos: [],
      sandbox: { mode: 'drive', cwd: 'projects/p/e' },
    });
    expect(context).toContain('https://dev.example.com/C/P/_git/R');
    expect(context).toContain('projects/p/e');
    expect(context).toContain('continue fixing');
    expect(context).toContain('persist');
    expect(context).not.toContain('No GitHub repositories have been pre-cloned');
    expect(context).not.toContain('gh repo fork');
    expect(context).not.toContain('Always commit and push');
  });

  it('describes temporary storage truthfully', () => {
    const context = buildTfsCloudAgentContext({ repos: [], sandbox: { mode: 'ephemeral' } });
    expect(context).toContain('temporary sandbox');
    expect(context).toContain('Never ask for passwords');
  });
});
