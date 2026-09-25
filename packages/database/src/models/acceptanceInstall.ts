import type { AcceptanceInstallEvent } from '@lobechat/types';

import type { NewAcceptanceInstall } from '../schemas/acceptanceInstall';
import { acceptanceInstalls } from '../schemas/acceptanceInstall';
import type { LobeChatDatabase } from '../type';

export interface RecordAcceptanceInstallParams {
  event: AcceptanceInstallEvent;
  version?: string;
}

/**
 * Append-only adoption telemetry for the CLI-distributed Acceptance skill
 * (`lh acceptance install` / `update`). Written by the verify router after a
 * successful install; read only by the ops dashboard, never by the product.
 */
export class AcceptanceInstallModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string | null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  record = async (params: RecordAcceptanceInstallParams) => {
    const values: NewAcceptanceInstall = {
      ...params,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    };
    const [row] = await this.db.insert(acceptanceInstalls).values(values).returning();

    return row;
  };
}
