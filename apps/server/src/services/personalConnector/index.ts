import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';

import type { PersonalReadEvidence } from './readEvidence';

export type PersonalConnectionStatus =
  | 'authorizing'
  | 'ready'
  | 'disconnected'
  | 'expired'
  | 'permission_required'
  | 'sync_failed'
  | 'unavailable'
  | 'disconnecting'
  | 'disconnect_failed';

export interface PersonalAuthorization {
  expiresAt: number;
  id: string;
  previous?: {
    accountKey?: string;
    accountLabel?: string;
    agentIds: string[];
    backendData?: Record<string, unknown>;
    remoteId?: string;
    readToolNames: string[];
    status: PersonalConnectionStatus;
  };
  requestId: string;
  status: 'pending' | 'complete' | 'cancelled' | 'expired' | 'unknown';
  url?: string;
}

/** Non-secret projection persisted on the existing connector row's metadata. */
export interface PersonalConnection {
  accessRevision?: number;
  accountKey?: string;
  accountLabel?: string;
  activeAgentIds?: string[];
  agentId?: string | null;
  agentIds: string[];
  authorization?: PersonalAuthorization;
  backendData?: Record<string, unknown>;
  grantedScopes?: string[] | null;
  id: string;
  isEnabled: boolean;
  lastError?: string;
  managed: boolean;
  name: string;
  providerId: string;
  reads?: PersonalReadEvidence[];
  readToolNames: string[];
  readToolVersions?: Record<string, string>;
  remoteId?: string;
  revision: number;
  status: PersonalConnectionStatus;
  userId: string;
}

export interface PersonalProvider {
  available: boolean;
  id: string;
  name: string;
  unavailableReason?: string;
}

export interface PersonalConnectionStore {
  get: (id: string) => Promise<PersonalConnection | null>;
  getBySession: (id: string) => Promise<PersonalConnection | null>;
  list: () => Promise<PersonalConnection[]>;
  remove: (id: string, expectedRevision: number) => Promise<void>;
  /** Atomically reserve a single pending operation in the exact personal scope. */
  reserve: (
    providerId: string,
    requestId: string,
    sessionId: string,
    expiresAt: number,
    options?: { connectionId?: string; adoptReadOnly?: boolean },
  ) => Promise<{
    connection: PersonalConnection;
    created: boolean;
  }>;
  /** Compare-and-set, returning the incremented version or throwing CONFLICT. */
  save: (
    connection: PersonalConnection,
    expectedRevision: number,
    options?: {
      confirmAgents?: boolean;
      replacements?: { id: string; revision: number }[];
    },
  ) => Promise<PersonalConnection>;
}

export interface PersonalConnectorBackend {
  authorize: (
    connection: PersonalConnection,
    callbackUrl: string,
  ) => Promise<{
    url: string;
    remoteId?: string;
    backendData?: Record<string, unknown>;
  }>;
  inspect: (connection: PersonalConnection) => Promise<{
    status:
      'pending' | 'ready' | 'expired' | 'permission_required' | 'sync_failed' | 'disconnected';
    accountKey?: string;
    accountLabel?: string;
    grantedScopes?: string[] | null;
    readToolNames: string[];
    readToolVersions?: Record<string, string>;
  }>;
  provider: PersonalProvider;
  revoke: (connection: PersonalConnection) => Promise<void>;
}

export interface PublicPersonalConnection {
  accessRevision: number;
  accountLabel?: string;
  activeAgentIds: string[];
  agentId: string | null;
  agentIds: string[];
  authorization?: Pick<PersonalAuthorization, 'id' | 'expiresAt' | 'status' | 'url'>;
  grantedScopes: string[] | null;
  id: string;
  isEnabled: boolean;
  lastError?: string;
  managed: boolean;
  name: string;
  providerId: string;
  /** Configuration readiness is deliberately independent from an actual read. */
  reading: 'unverified' | 'verified';
  reads: PersonalReadEvidence[];
  revision: number;
  status: PersonalConnectionStatus;
}

interface PersonalConnectorDeps {
  backends: PersonalConnectorBackend[];
  bootstrap?: (providerId?: string) => Promise<void>;
  callbackUrl: string;
  canEditAgents: (ids: string[]) => Promise<boolean>;
  newId?: () => string;
  now?: () => number;
  store: PersonalConnectionStore;
  userId: string;
}

const publicConnection = (row: PersonalConnection): PublicPersonalConnection => ({
  id: row.id,
  grantedScopes: row.grantedScopes ?? null,
  providerId: row.providerId,
  name: row.name,
  agentId: row.agentId ?? null,
  status: row.status,
  managed: row.managed,
  revision: row.revision,
  agentIds: row.agentIds,
  accountLabel: row.accountLabel,
  lastError: row.lastError,
  authorization: row.authorization && {
    id: row.authorization.id,
    expiresAt: row.authorization.expiresAt,
    status: row.authorization.status,
    url: row.authorization.url,
  },
  reading: row.reads?.some((read) => read.outcome === 'data') ? 'verified' : 'unverified',
  accessRevision: row.accessRevision ?? row.revision,
  activeAgentIds:
    row.activeAgentIds ?? (row.isEnabled && row.status === 'ready' ? row.agentIds : []),
  reads: row.reads ?? [],
  isEnabled: row.isEnabled,
});

/** Provider-neutral orchestration. Ownership is checked again before every effect. */
export class PersonalConnectorService {
  private now: () => number;
  private newId: () => string;

  constructor(private deps: PersonalConnectorDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  catalog(): PersonalProvider[] {
    return this.deps.backends.map(({ provider }) => ({ ...provider }));
  }

  private backend(providerId: string) {
    const backend = this.deps.backends.find((item) => item.provider.id === providerId);
    if (!backend?.provider.available) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This service is not available' });
    }
    return backend;
  }

  private owned(row: PersonalConnection | null): PersonalConnection {
    if (!row || row.userId !== this.deps.userId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
    }
    return row;
  }

  async list(): Promise<PublicPersonalConnection[]> {
    await this.deps.bootstrap?.();
    return (await this.deps.store.list())
      .filter((row) => row.userId === this.deps.userId)
      .map(publicConnection);
  }

  async get(id: string) {
    return publicConnection(this.owned(await this.deps.store.get(id)));
  }

  async refresh(id: string) {
    const row = this.owned(await this.deps.store.get(id));
    if (row.authorization && ['pending', 'unknown'].includes(row.authorization.status))
      return this.reconcile(row.authorization.id);
    if (['disconnecting', 'disconnect_failed'].includes(row.status)) return publicConnection(row);
    const observed = await this.backend(row.providerId).inspect(row);
    return this.applyObservation(row, observed);
  }

  async authorize(input: {
    providerId: string;
    requestId: string;
    connectionId?: string;
    adoptReadOnly?: boolean;
  }) {
    const backend = this.backend(input.providerId);
    await this.deps.bootstrap?.(input.providerId);
    const reserved = await this.deps.store.reserve(
      input.providerId,
      input.requestId,
      this.newId(),
      this.now() + 10 * 60_000,
      { connectionId: input.connectionId, adoptReadOnly: input.adoptReadOnly },
    );
    const row = this.owned(reserved.connection);
    if (!reserved.created) return publicConnection(row);

    const callback = new URL(this.deps.callbackUrl);
    callback.searchParams.set('connectionId', row.id);
    callback.searchParams.set('session', row.authorization!.id);
    try {
      const result = await backend.authorize(row, callback.toString());
      if (new URL(result.url).protocol !== 'https:') throw new Error('Invalid authorization URL');
      return publicConnection(
        await this.deps.store.save(
          {
            ...row,
            remoteId: result.remoteId,
            backendData: result.backendData,
            authorization: { ...row.authorization!, url: result.url },
          },
          row.revision,
        ),
      );
    } catch {
      // A lost response does not prove that the provider failed to create a link.
      // Retrying this request must reconcile the reserved operation, not create another.
      return publicConnection(
        await this.deps.store.save(
          {
            ...row,
            lastError: 'Authorization could not be confirmed. Check its status before retrying.',
            authorization: { ...row.authorization!, status: 'unknown' },
          },
          row.revision,
        ),
      );
    }
  }

  async reconcile(sessionId: string, cancelRequested = false) {
    const row = this.owned(await this.deps.store.getBySession(sessionId));
    const authorization = row.authorization!;
    if (['disconnecting', 'disconnect_failed'].includes(row.status)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Disconnect is still being processed' });
    }
    const backend = this.backend(row.providerId);
    const observed = await backend.inspect(row);

    if (observed.status === 'pending') {
      if (cancelRequested) {
        try {
          await backend.revoke(row);
          return publicConnection(
            await this.deps.store.save(
              {
                ...row,
                isEnabled: false,
                agentIds: [],
                status: 'disconnected',
                authorization: { ...authorization, status: 'cancelled', url: undefined },
              },
              row.revision,
              { confirmAgents: true },
            ),
          );
        } catch {
          return publicConnection(
            await this.deps.store.save(
              {
                ...row,
                authorization: { ...authorization, status: 'unknown' },
                lastError: 'Cancellation could not be confirmed. Check the connection again.',
              },
              row.revision,
            ),
          );
        }
      }
      if (this.now() >= authorization.expiresAt) {
        return publicConnection(
          await this.deps.store.save(
            {
              ...row,
              status: 'expired',
              isEnabled: false,
              agentIds: row.agentIds,
              authorization: { ...authorization, status: 'expired', url: undefined },
            },
            row.revision,
          ),
        );
      }
      return publicConnection(row);
    }

    return this.applyObservation(row, observed);
  }

  private async applyObservation(
    row: PersonalConnection,
    observed: Awaited<ReturnType<PersonalConnectorBackend['inspect']>>,
  ) {
    const readToolNames = [...new Set(observed.readToolNames)];
    const ready = observed.status === 'ready' && readToolNames.length > 0;
    const previous =
      row.authorization?.status !== 'complete' ? row.authorization?.previous : undefined;
    const identityChanged =
      !!row.accountKey && !!observed.accountKey && row.accountKey !== observed.accountKey;
    // Retain disabled selections during expiry. A changed/unknown OAuth identity needs new consent.
    const restoringStoppedSelection =
      row.agentIds.length > 0 && (!row.isEnabled || row.status !== 'ready');
    const verifiedSamePrincipal =
      !!observed.accountKey && (previous?.accountKey ?? row.accountKey) === observed.accountKey;
    const mustReconfirm =
      identityChanged ||
      (ready && (restoringStoppedSelection || !!previous) && !verifiedSamePrincipal);
    const agentIds = mustReconfirm ? [] : row.agentIds;
    const ownedAgents = await this.deps.canEditAgents(agentIds);
    const nextStatus =
      observed.status === 'pending'
        ? 'disconnected'
        : observed.status === 'ready' && !ready
          ? 'sync_failed'
          : observed.status;
    return publicConnection(
      await this.deps.store.save(
        {
          ...row,
          status: nextStatus,
          accountKey: ready ? observed.accountKey : (observed.accountKey ?? row.accountKey),
          accountLabel: ready ? observed.accountLabel : (observed.accountLabel ?? row.accountLabel),
          agentIds: ownedAgents ? agentIds : [],
          readToolNames,
          readToolVersions: observed.readToolVersions ?? {},
          grantedScopes: observed.grantedScopes ?? null,
          isEnabled: ready && ownedAgents && agentIds.length > 0,
          lastError: undefined,
          authorization: row.authorization && {
            ...row.authorization,
            status: observed.status === 'expired' ? 'expired' : 'complete',
            url: undefined,
          },
        },
        row.revision,
        { confirmAgents: (mustReconfirm || !ownedAgents) && row.managed },
      ),
    );
  }

  async setAgents(
    id: string,
    requested: string[],
    revision: number,
    adoptReadOnly = false,
    replacements: { id: string; revision: number }[] = [],
  ) {
    let row = this.owned(await this.deps.store.get(id));
    if (row.revision !== revision)
      throw new TRPCError({ code: 'CONFLICT', message: 'Connection version conflict' });
    if (row.managed && (row.status !== 'ready' || row.readToolNames.length === 0)) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Connection is not ready' });
    }
    if (!row.managed && !adoptReadOnly) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Confirm read-only management for this existing connection',
      });
    }
    const agentIds = [...new Set(requested)];
    if (
      (row.agentId && agentIds.some((agentId) => agentId !== row.agentId)) ||
      !(await this.deps.canEditAgents(agentIds))
    ) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent access cannot be changed' });
    }
    if (!row.managed) {
      const observed = await this.backend(row.providerId).inspect(row);
      if (observed.status !== 'ready' || !observed.readToolNames.length)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Connection is not ready' });
      row = {
        ...row,
        accountKey: observed.accountKey,
        accountLabel: observed.accountLabel,
        readToolNames: observed.readToolNames,
        readToolVersions: observed.readToolVersions,
        grantedScopes: observed.grantedScopes ?? null,
      };
    }
    return publicConnection(
      await this.deps.store.save(
        {
          ...row,
          managed: true,
          agentIds,
          isEnabled: agentIds.length > 0,
        },
        revision,
        { confirmAgents: true, replacements },
      ),
    );
  }

  async disconnect(id: string, revision: number) {
    const row = this.owned(await this.deps.store.get(id));
    if (row.revision !== revision)
      throw new TRPCError({ code: 'CONFLICT', message: 'Connection version conflict' });
    // Persist local denial BEFORE any remote operation, retaining remote identity for retry.
    const disabled = await this.deps.store.save(
      {
        ...row,
        managed: true,
        isEnabled: false,
        agentIds: [],
        status: 'disconnecting',
      },
      revision,
      { confirmAgents: true },
    );
    try {
      await this.backend(row.providerId).revoke(disabled);
    } catch (error) {
      const failed = await this.deps.store.save(
        {
          ...disabled,
          status: 'disconnect_failed',
          lastError:
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'CONNECTION_SHARED'
              ? 'account_shared'
              : 'Access is stopped locally. The provider could not be disconnected.',
        },
        disabled.revision,
      );
      return {
        connection: publicConnection(failed),
        localDisabled: true,
        remoteDisconnected: false,
      };
    }
    await this.deps.store.remove(id, disabled.revision);
    return { connection: null, localDisabled: true, remoteDisconnected: true };
  }
}
