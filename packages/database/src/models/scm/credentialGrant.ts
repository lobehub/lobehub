import type {
  ScmCreateCredentialGrantParams,
  ScmListCredentialGrantsParams,
} from '@lobechat/types';
import { and, desc, eq, lt, ne } from 'drizzle-orm';

import type { ScmCredentialGrantItem } from '../../schemas';
import { agentOperations, scmCredentialGrants } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export class ScmCredentialGrantModel {
  static create = async (
    db: LobeChatDatabase,
    params: ScmCreateCredentialGrantParams,
  ): Promise<ScmCredentialGrantItem> => {
    const [row] = await db
      .insert(scmCredentialGrants)
      .values({
        deviceId: params.deviceId ?? null,
        operationId: params.operationId,
        path: params.path,
        repo: params.repo ?? null,
        requesterUserId: params.requesterUserId,
        result: params.result,
        tokenExpiresAt: params.tokenExpiresAt ?? null,
        workspaceId: params.workspaceId,
        ...(params.createdAt ? { createdAt: params.createdAt } : {}),
      })
      .returning();

    return row;
  };

  static list = async (
    db: LobeChatDatabase,
    params: ScmListCredentialGrantsParams,
  ): Promise<ScmCredentialGrantItem[]> => {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);

    return db
      .select()
      .from(scmCredentialGrants)
      .where(
        and(
          eq(scmCredentialGrants.workspaceId, params.workspaceId),
          params.requesterUserId
            ? eq(scmCredentialGrants.requesterUserId, params.requesterUserId)
            : undefined,
          params.repo ? eq(scmCredentialGrants.repo, params.repo) : undefined,
          params.before ? lt(scmCredentialGrants.createdAt, params.before) : undefined,
        ),
      )
      .orderBy(desc(scmCredentialGrants.createdAt))
      .limit(limit);
  };

  static issuedRequesterIds = async (
    db: LobeChatDatabase,
    operationId: string,
  ): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ requesterUserId: scmCredentialGrants.requesterUserId })
      .from(scmCredentialGrants)
      .where(
        and(
          eq(scmCredentialGrants.operationId, operationId),
          eq(scmCredentialGrants.result, 'issued'),
        ),
      );

    return rows.map((row) => row.requesterUserId);
  };

  static hasOtherRunningIssued = async (
    db: LobeChatDatabase,
    requesterUserId: string,
    excludeOperationId: string,
  ): Promise<boolean> => {
    const [row] = await db
      .select({ id: scmCredentialGrants.id })
      .from(scmCredentialGrants)
      .innerJoin(agentOperations, eq(agentOperations.id, scmCredentialGrants.operationId))
      .where(
        and(
          eq(scmCredentialGrants.requesterUserId, requesterUserId),
          eq(scmCredentialGrants.result, 'issued'),
          ne(scmCredentialGrants.operationId, excludeOperationId),
          eq(agentOperations.status, 'running'),
        ),
      )
      .limit(1);

    return !!row;
  };
}
