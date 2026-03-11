import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<ChatStore>;

export class SessionBypassActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  bypassAuditForSession = (auditType: string): void => {
    const key = this.#getCurrentKey();
    const current = this.#get().sessionBypassedAudits[key] ?? [];
    if (current.includes(auditType)) return;

    this.#set(
      {
        sessionBypassedAudits: {
          ...this.#get().sessionBypassedAudits,
          [key]: [...current, auditType],
        },
      },
      false,
      'bypassAuditForSession',
    );
  };

  getSessionBypassedAudits = (): string[] => {
    const key = this.#getCurrentKey();
    return this.#get().sessionBypassedAudits[key] ?? [];
  };

  #getCurrentKey(): string {
    const { activeAgentId, activeTopicId } = this.#get();
    return `${activeAgentId}-${activeTopicId ?? 'default'}`;
  }
}

export type SessionBypassAction = Pick<SessionBypassActionImpl, keyof SessionBypassActionImpl>;
