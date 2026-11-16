import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareComposerGitSend } from './index';
import { prepareDraftGitSend, resolveDraftGitTarget } from './prepareSend';

vi.mock('./prepareSend', () => ({
  prepareDraftGitSend: vi.fn(),
  resolveDraftGitTarget: vi.fn(),
}));
vi.mock('./sendPrompts', () => ({ draftGitSendPrompts: {} }));

const target = (agentId: string) => ({
  agentId,
  isGithub: true,
  path: '/repo',
  sourcePath: '/repo',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('prepareComposerGitSend', () => {
  it('passes a send with nothing to prepare without waiting on another composer', async () => {
    let release!: (value: { ok: true }) => void;
    vi.mocked(resolveDraftGitTarget).mockImplementation((context) =>
      context.agentId === 'agent-a' ? target('agent-a') : undefined,
    );
    vi.mocked(prepareDraftGitSend).mockReturnValue(new Promise((resolve) => (release = resolve)));

    const slow = prepareComposerGitSend({ agentId: 'agent-a', topicId: null });
    // Another conversation (an existing topic, another agent) sends meanwhile.
    await expect(prepareComposerGitSend({ agentId: 'agent-b', topicId: 'tpc_1' })).resolves.toEqual(
      { ok: true },
    );

    release({ ok: true });
    await expect(slow).resolves.toEqual({ ok: true });
  });

  it('refuses a second send from the same composer while its git step runs', async () => {
    let release!: (value: { ok: true }) => void;
    vi.mocked(resolveDraftGitTarget).mockReturnValue(target('agent-a'));
    vi.mocked(prepareDraftGitSend).mockReturnValue(new Promise((resolve) => (release = resolve)));

    const first = prepareComposerGitSend({ agentId: 'agent-a', topicId: null });
    await expect(prepareComposerGitSend({ agentId: 'agent-a', topicId: null })).resolves.toEqual({
      ok: false,
    });

    release({ ok: true });
    await first;
    // Released once it settles.
    vi.mocked(prepareDraftGitSend).mockResolvedValue({ ok: true });
    await expect(prepareComposerGitSend({ agentId: 'agent-a', topicId: null })).resolves.toEqual({
      ok: true,
    });
  });
});
