import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareComposerGitSend } from './index';
import { prepareDraftGitSend, snapshotDraftGit } from './prepareSend';

vi.mock('./prepareSend', () => ({
  prepareDraftGitSend: vi.fn(),
  snapshotDraftGit: vi.fn(),
}));
vi.mock('./sendPrompts', () => ({ draftGitSendPrompts: {} }));

const snap = (agentId: string) => ({
  picked: 'feat',
  target: { agentId, isGithub: true, path: '/repo', sourcePath: '/repo' },
  worktreeMode: false,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('prepareComposerGitSend', () => {
  it('passes a send with nothing to prepare without waiting on another composer', async () => {
    let release!: (value: { ok: true }) => void;
    vi.mocked(snapshotDraftGit).mockImplementation((context) =>
      context.agentId === 'agent-a' ? snap('agent-a') : undefined,
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
    vi.mocked(snapshotDraftGit).mockReturnValue(snap('agent-a'));
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

  it('uses the snapshot taken at send time, not the composer as it is later', async () => {
    vi.mocked(prepareDraftGitSend).mockResolvedValue({ acted: true, ok: true });
    const snapshot = snap('agent-a');

    await prepareComposerGitSend({ agentId: 'agent-a', topicId: null }, { snapshot });

    expect(snapshotDraftGit).not.toHaveBeenCalled();
    expect(prepareDraftGitSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ snapshot }),
    );
  });

  it('does nothing when there was nothing to prepare at send time', async () => {
    await expect(
      prepareComposerGitSend({ agentId: 'agent-a', topicId: null }, { snapshot: null }),
    ).resolves.toEqual({ ok: true });
    expect(snapshotDraftGit).not.toHaveBeenCalled();
    expect(prepareDraftGitSend).not.toHaveBeenCalled();
  });
});
