import { toast } from '@lobehub/ui';
import { t } from 'i18next';

export interface MovedSubSession {
  agentId: null | string;
  agentTitle: null | string;
  movedToOwnAgent: boolean;
}

/**
 * Sub-sessions of other agents that left this list went back to their own
 * agent's list: say where, once, with a way to each — so none looks lost.
 */
export const notifyMovedSubSessions = (
  moved: MovedSubSession[],
  openAgent: (agentId: string) => void,
) => {
  const byAgent = new Map<string, { count: number; title: string }>();
  for (const row of moved) {
    if (!row.movedToOwnAgent || !row.agentId) continue;
    const entry = byAgent.get(row.agentId) ?? {
      count: 0,
      title: row.agentTitle || t('subSession.moved.unnamedAgent', { ns: 'topic' }),
    };
    entry.count += 1;
    byAgent.set(row.agentId, entry);
  }
  if (byAgent.size === 0) return;

  const total = [...byAgent.values()].reduce((sum, entry) => sum + entry.count, 0);
  const agents = [...byAgent.values()]
    .map((entry) =>
      t('subSession.moved.agent', { count: entry.count, name: entry.title, ns: 'topic' }),
    )
    .join(t('subSession.moved.separator', { ns: 'topic' }));

  toast.info({
    actions: [...byAgent.entries()].map(([agentId, entry]) => ({
      label: entry.title,
      onClick: () => openAgent(agentId),
      variant: 'text' as const,
    })),
    description: agents,
    title: t('subSession.moved.title', { count: total, ns: 'topic' }),
  });
};
