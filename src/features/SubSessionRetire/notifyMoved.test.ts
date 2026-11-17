import { toast } from '@lobehub/ui';
import { describe, expect, it, vi } from 'vitest';

import { notifyMovedSubSessions } from './notifyMoved';

vi.mock('@lobehub/ui', () => ({ toast: { info: vi.fn() } }));
vi.mock('i18next', () => ({
  t: (key: string, options?: Record<string, unknown>) =>
    `${key}${options?.count !== undefined ? `:${options.count}` : ''}${options?.name ? `:${options.name}` : ''}`,
}));

describe('notifyMovedSubSessions', () => {
  it('says once where moved sub-sessions of other agents went, with a way to each agent', () => {
    const openAgent = vi.fn();

    notifyMovedSubSessions(
      [
        { agentId: 'agt_codex', agentTitle: 'Codex', movedToOwnAgent: true },
        { agentId: 'agt_cc', agentTitle: 'Claude Code', movedToOwnAgent: true },
        { agentId: 'agt_codex', agentTitle: 'Codex', movedToOwnAgent: true },
        { agentId: 'agt_self', agentTitle: 'Me', movedToOwnAgent: false },
      ],
      openAgent,
    );

    expect(toast.info).toHaveBeenCalledTimes(1);
    const call = vi.mocked(toast.info).mock.calls[0][0] as any;
    expect(call.title).toBe('subSession.moved.title:3');
    expect(call.actions.map((action: any) => action.label)).toEqual(['Codex', 'Claude Code']);
    call.actions[1].onClick();
    expect(openAgent).toHaveBeenCalledWith('agt_cc');
  });

  it('stays quiet when nothing left the list', () => {
    vi.mocked(toast.info).mockClear();

    notifyMovedSubSessions(
      [{ agentId: 'agt_self', agentTitle: 'Me', movedToOwnAgent: false }],
      vi.fn(),
    );

    expect(toast.info).not.toHaveBeenCalled();
  });
});
