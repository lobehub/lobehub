import type { SkillInstallEvent } from '@lobechat/types';

import type { NewSkillInstall } from '../schemas/skillInstall';
import { skillInstalls } from '../schemas/skillInstall';
import type { LobeChatDatabase } from '../type';

export interface RecordSkillInstallParams {
  event: SkillInstallEvent;
  identifier: string;
  version?: string;
}

/**
 * Append-only adoption telemetry for CLI-distributed skills
 * (`lh acceptance install` / `update`). Written by the verify router after a
 * successful install; read only by the ops dashboard, never by the product.
 */
export class SkillInstallModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string | null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  record = async (params: RecordSkillInstallParams) => {
    const values: NewSkillInstall = {
      ...params,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    };
    const [row] = await this.db.insert(skillInstalls).values(values).returning();

    return row;
  };
}
