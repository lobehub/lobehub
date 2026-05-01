import { eq } from 'drizzle-orm';

import { marketAccounts } from '../../../../packages/database/src/schemas/market';
import { MarketHttpError } from '../http/errors';
import type { MarketDatabase, TrustedClientPayload } from '../types';

const MAX_NAMESPACE_LENGTH = 100;
const MAX_NAMESPACE_ATTEMPTS = 100;

const normalizeSegment = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9_-]/g, '-');

const normalizeNamespaceBase = (payload: TrustedClientPayload) => {
  const localPart = payload.email.split('@')[0] || payload.userId;
  const namespace = normalizeSegment(localPart).slice(0, MAX_NAMESPACE_LENGTH);

  return namespace || normalizeSegment(payload.userId).slice(0, MAX_NAMESPACE_LENGTH) || 'user';
};

const buildNamespaceVariant = (base: string, userId: string, attempt: number) => {
  const normalizedUserId = normalizeSegment(userId) || 'user';
  const suffix = attempt === 0 ? normalizedUserId : `${normalizedUserId}-${attempt}`;
  const baseLength = Math.max(1, MAX_NAMESPACE_LENGTH - suffix.length - 1);

  return `${base.slice(0, baseLength)}-${suffix}`.slice(0, MAX_NAMESPACE_LENGTH);
};

const getErrorConstraint = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('cause' in error)) return;

  const { cause } = error;
  if (!cause || typeof cause !== 'object' || !('constraint' in cause)) return;

  const { constraint } = cause;
  return typeof constraint === 'string' ? constraint : undefined;
};

const isNamespaceCollision = (error: unknown) => {
  const constraint = getErrorConstraint(error);

  return (
    constraint === 'market_accounts_namespace_unique' ||
    constraint === 'market_accounts_user_name_unique'
  );
};

export class MarketAccountModel {
  constructor(private readonly db: MarketDatabase) {}

  async findById(id: number) {
    const [account] = await this.db
      .select()
      .from(marketAccounts)
      .where(eq(marketAccounts.id, id))
      .limit(1);

    return account;
  }

  async findByLobeUserId(lobeUserId: string) {
    const [account] = await this.db
      .select()
      .from(marketAccounts)
      .where(eq(marketAccounts.lobeUserId, lobeUserId))
      .limit(1);

    return account;
  }

  private async createUniqueNamespace(payload: TrustedClientPayload) {
    const base = normalizeNamespaceBase(payload);

    for (let attempt = 0; attempt < MAX_NAMESPACE_ATTEMPTS; attempt += 1) {
      const namespace =
        attempt === 0 ? base : buildNamespaceVariant(base, payload.userId, attempt - 1);
      const [existing] = await this.db
        .select({ lobeUserId: marketAccounts.lobeUserId })
        .from(marketAccounts)
        .where(eq(marketAccounts.namespace, namespace))
        .limit(1);

      if (!existing || existing.lobeUserId === payload.userId) return namespace;
    }

    return buildNamespaceVariant(base, payload.userId, MAX_NAMESPACE_ATTEMPTS - 1);
  }

  private async upsertWithNamespace(payload: TrustedClientPayload, namespace: string) {
    const [account] = await this.db
      .insert(marketAccounts)
      .values({
        displayName: payload.name,
        email: payload.email,
        lobeUserId: payload.userId,
        namespace,
        userName: namespace,
      })
      .onConflictDoUpdate({
        set: {
          displayName: payload.name,
          email: payload.email,
          updatedAt: new Date(),
        },
        target: marketAccounts.lobeUserId,
      })
      .returning();

    return account;
  }

  async upsertFromTrustedPayload(payload: TrustedClientPayload) {
    const base = normalizeNamespaceBase(payload);

    for (let attempt = 0; attempt < MAX_NAMESPACE_ATTEMPTS; attempt += 1) {
      const namespace =
        attempt === 0
          ? await this.createUniqueNamespace(payload)
          : buildNamespaceVariant(base, payload.userId, attempt - 1);

      try {
        return await this.upsertWithNamespace(payload, namespace);
      } catch (error) {
        if (!isNamespaceCollision(error)) throw error;
      }
    }

    throw new MarketHttpError(
      409,
      'market_account_namespace_exhausted',
      'Unable to allocate a unique Market account namespace.',
    );
  }
}
