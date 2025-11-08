import { CreateThreadParams, ThreadStatus } from '@lobechat/types';
import { and, desc, eq } from 'drizzle-orm';

import { ThreadItem, threads } from '../schemas';
import { LobeChatDatabase } from '../type';

const queryColumns = {
  createdAt: threads.createdAt,
  id: threads.id,
  parentThreadId: threads.parentThreadId,
  sourceMessageId: threads.sourceMessageId,
  status: threads.status,
  title: threads.title,
  topicId: threads.topicId,
  type: threads.type,
  updatedAt: threads.updatedAt,
};

export class ThreadModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: CreateThreadParams) => {
    // @ts-ignore
    const [result] = await this.db
      .insert(threads)
      .values({ ...params, status: ThreadStatus.Active, userId: this.userId })
      .onConflictDoNothing()
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.delete(threads).where(and(eq(threads.id, id), eq(threads.userId, this.userId)));
  };

  deleteAll = async () => {
    return this.db.delete(threads).where(eq(threads.userId, this.userId));
  };

  query = async () => {
    const data = await this.db
      .select(queryColumns)
      .from(threads)
      .where(eq(threads.userId, this.userId))
      .orderBy(desc(threads.updatedAt));

    return data as ThreadItem[];
  };

  queryByTopicId = async (topicId: string) => {
    const data = await this.db
      .select(queryColumns)
      .from(threads)
      .where(and(eq(threads.topicId, topicId), eq(threads.userId, this.userId)))
      .orderBy(desc(threads.updatedAt));

    return data as ThreadItem[];
  };

  findById = async (id: string) => {
    return this.db.query.threads.findFirst({
      where: and(eq(threads.id, id), eq(threads.userId, this.userId)),
    });
  };

  update = async (id: string, value: Partial<ThreadItem>) => {
    return this.db
      .update(threads)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(threads.id, id), eq(threads.userId, this.userId)));
  };
}
