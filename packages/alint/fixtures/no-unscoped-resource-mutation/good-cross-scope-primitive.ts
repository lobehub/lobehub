import { eq } from 'drizzle-orm';

import { bindings, type Database } from './schema';

export class BindingModel {
  constructor(
    private db: Database,
    private userId: string,
  ) {}

  /** Privileged cross-scope primitive. Caller MUST authorize the row before calling. */
  deleteAcrossScopes(id: string) {
    return this.db.delete(bindings).where(eq(bindings.id, id));
  }
}
