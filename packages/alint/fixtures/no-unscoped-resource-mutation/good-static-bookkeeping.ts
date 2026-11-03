import { eq } from 'drizzle-orm';

import { type Database, jobs } from './schema';

export class JobModel {
  constructor(private userId: string) {}

  // Background scheduler bookkeeping after executing an already-selected job.
  static async recordExecution(db: Database, jobId: string) {
    return db.update(jobs).set({ lastExecutedAt: new Date() }).where(eq(jobs.id, jobId));
  }
}
