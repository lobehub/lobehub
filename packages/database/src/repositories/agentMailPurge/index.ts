import { AgentMailModel } from '../../models/agentMail';
import { SignalModel } from '../../models/signal';
import type { LobeChatDatabase } from '../../type';

/**
 * Permanently deleting mail, as one unit of work: the mail and its inbox item
 * are wiped, and so is the raw webhook payload of the signal each mail arrived
 * as — a second copy of its subject, snippet, recipients and codes. One
 * transaction, so a failure leaves the mail purgeable again instead of gone
 * with its payload still readable.
 */
export class AgentMailPurgeRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /** Purge these trashed mails; returns the ids it wiped. */
  purge = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return [];

    return this.db.transaction(async (tx) => {
      const purged = await new AgentMailModel(tx, this.userId, this.workspaceId).purge(ids);
      await new SignalModel(tx, this.userId, this.workspaceId).purgePayloads(
        purged.flatMap((mail) => (mail.signalId ? [mail.signalId] : [])),
      );

      return purged.map((mail) => mail.id);
    });
  };
}
