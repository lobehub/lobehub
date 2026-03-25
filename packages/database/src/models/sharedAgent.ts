import { asc, eq } from 'drizzle-orm';

import type { NewSharedAgent, SharedAgent } from '../schemas';
import { sharedAgents } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class SharedAgentModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  list = async (): Promise<SharedAgent[]> => {
    return this.db.query.sharedAgents.findMany({
      orderBy: [asc(sharedAgents.sort), asc(sharedAgents.createdAt)],
      where: eq(sharedAgents.enabled, true),
    });
  };

  listAll = async (): Promise<SharedAgent[]> => {
    return this.db.query.sharedAgents.findMany({
      orderBy: [asc(sharedAgents.sort), asc(sharedAgents.createdAt)],
    });
  };

  findById = async (id: string): Promise<SharedAgent | undefined> => {
    return this.db.query.sharedAgents.findFirst({
      where: eq(sharedAgents.id, id),
    });
  };

  create = async (
    params: Omit<NewSharedAgent, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SharedAgent> => {
    const [result] = await this.db.insert(sharedAgents).values(params).returning();
    return result;
  };

  update = async (id: string, value: Partial<NewSharedAgent>): Promise<SharedAgent> => {
    const [result] = await this.db
      .update(sharedAgents)
      .set({ ...value, updatedAt: new Date() })
      .where(eq(sharedAgents.id, id))
      .returning();
    return result;
  };

  delete = async (id: string): Promise<void> => {
    await this.db.delete(sharedAgents).where(eq(sharedAgents.id, id));
  };

  toggleEnabled = async (id: string, enabled: boolean): Promise<SharedAgent> => {
    const [result] = await this.db
      .update(sharedAgents)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(sharedAgents.id, id))
      .returning();
    return result;
  };
}
