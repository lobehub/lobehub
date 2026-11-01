// Fixture: a same-table lock + update is a legitimate model-level guard.
import { eq } from 'drizzle-orm';

import { jobs } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class JobModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async claim(id: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
      await tx.update(jobs).set({ claimed: true }).where(eq(jobs.id, id));
      return row;
    });
  }
}
