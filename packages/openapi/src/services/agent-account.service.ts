import type { AgentAccountPatch, AgentAccountView } from '@/database/models/agentAccount';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AgentAccountService } from '@/server/services/agentIdentity';
import { createDefaultAgentAccountRegistry } from '@/server/services/agentIdentity/providers';
import type { AgentAccountProviderRegistry } from '@/server/services/agentIdentity/registry';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type {
  AgentAccountListQuery,
  CreateAgentAccountRequest,
  RevokeAgentAccountQuery,
  SetAgentAccountCredentialRequest,
  UpdateAgentAccountRequest,
} from '../types/agent-account.type';

/**
 * Agent accounts REST service.
 *
 * A thin transport shell over the same `AgentAccountService` the tRPC router
 * drives, so a REST client sees exactly the provider behaviour the product has
 * instead of a parallel copy of it. This layer only decides who may ask, and
 * which of the two `POST` modes the body selected.
 *
 * Two invariants the paths imply and this service enforces:
 *
 * - `/agents/{id}/accounts` names an agent, so every call proves the caller may
 *   use that agent (`assertAgentUsableBy`, the same predicate task assignees and
 *   bot bindings use). Another user's private agent answers 404, never 403, so
 *   its existence cannot be probed.
 * - The account must actually belong to the agent in the path; an account
 *   reached through a different agent's URL is a 404 rather than a read of the
 *   caller's unrelated row.
 */
/**
 * Postgres/drizzle unique-index violation (`23505`). The engine puts the code
 * on the error itself or on its `cause` depending on the driver, so both are
 * checked — same shape `agentBotProvider` relies on.
 */
const isUniqueViolation = (error: unknown): boolean => {
  const candidate = error as { cause?: { code?: string }; code?: string };
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
};

export class AgentAccountRestService extends BaseService {
  private identityService: AgentAccountService | null = null;
  private readonly registry: AgentAccountProviderRegistry;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.registry = createDefaultAgentAccountRegistry();
  }

  /**
   * The identity service takes an async gatekeeper, so it is built once, on
   * first use. Building it never touches the provider network — only
   * `provision` / `release` / `send` do.
   */
  private async identity(): Promise<AgentAccountService> {
    this.identityService ??= new AgentAccountService(this.db, this.userId, {
      gateKeeper: await KeyVaultsGateKeeper.initWithEnvKey(),
      registry: this.registry,
      workspaceId: this.workspaceId,
    });
    return this.identityService;
  }

  /**
   * A provider this deployment has not configured is a client error with an
   * actionable message, not a 500. The registry is the authority on which
   * providers exist, so asking it first keeps the refusal a 400.
   */
  private requireProvider(provider: string): void {
    if (this.registry.has(provider)) return;

    const known = this.registry.list().map((entry) => entry.provider);
    throw this.createValidationError(
      `Unknown agent account provider "${provider}". Registered providers: ` +
        `${known.length > 0 ? known.join(', ') : '(none — no identity provider is configured for this deployment)'}`,
    );
  }

  private async requireAgent(agentId: string): Promise<void> {
    try {
      await assertAgentUsableBy(this.db, agentId, {
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      if ((error as Error)?.name === 'TRPCError') {
        throw this.createNotFoundError('Agent not found');
      }
      throw error;
    }
  }

  /**
   * The agent in the path is checked first, so an account of a colleague's
   * private agent answers 404 exactly like the agent itself does — reaching it
   * by account id must not bypass the agent's visibility.
   */
  private async requireAccount(agentId: string, accountId: string): Promise<AgentAccountView> {
    await this.requireAgent(agentId);

    const account = await (await this.identity()).get(accountId);
    if (!account || account.agentId !== agentId) {
      throw this.createNotFoundError('Agent account not found');
    }
    return account;
  }

  /** The accounts in the caller's scope, credentials structurally absent. */
  async listAccounts(
    agentId: string,
    query: AgentAccountListQuery,
  ): ServiceResult<{ accounts: AgentAccountView[]; total: number }> {
    await this.requireAgent(agentId);

    const accounts = await (
      await this.identity()
    ).list({ agentId, kind: query.kind, provider: query.provider });

    return { accounts, total: accounts.length };
  }

  /** GET one account — `identifier`, `capabilities`, `credentialHint`, `hasCredential`. */
  async getAccount(agentId: string, accountId: string): ServiceResult<AgentAccountView> {
    return this.requireAccount(agentId, accountId);
  }

  /**
   * Mount an existing handle, or ask the provider to issue a new account.
   * Never accepts a credential — that is the write-only sub-resource's job.
   */
  async createAccount(
    agentId: string,
    body: CreateAgentAccountRequest,
  ): ServiceResult<AgentAccountView> {
    await this.requireAgent(agentId);
    const identity = await this.identity();

    if ('identifier' in body) {
      // Mounting a handle the caller already has needs no provider
      // implementation — but only when the caller states what the account can
      // do. Without capabilities the provider has to declare them, so an
      // unknown provider string is a typo and answers 400.
      if (!body.capabilities) this.requireProvider(body.provider);

      try {
        return await identity.create({ agentId, ...body });
      } catch (error) {
        // `(provider, identifier)` is unique deployment-wide: the same handle
        // cannot be a second identity, so a duplicate is a 409, not a 500.
        if (isUniqueViolation(error)) {
          throw this.createConflictError(
            `An account with identifier "${body.identifier}" for provider "${body.provider}" is already registered.`,
          );
        }
        throw error;
      }
    }

    this.requireProvider(body.provider);

    return identity.provision({
      agentId,
      displayName: body.displayName,
      provider: body.provider,
    });
  }

  /** Patch the non-secret fields; `status` moves through revoke, not here. */
  async updateAccount(
    agentId: string,
    accountId: string,
    body: UpdateAgentAccountRequest,
  ): ServiceResult<AgentAccountView> {
    await this.requireAccount(agentId, accountId);

    const patch: AgentAccountPatch = {};
    if (body.capabilities) patch.capabilities = body.capabilities;
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.metadata) patch.metadata = body.metadata;

    await (await this.identity()).update(accountId, patch);

    return this.requireAccount(agentId, accountId);
  }

  /**
   * Install or rotate the credential. Write-only: the returned view carries the
   * non-secret hint and `hasCredential`, never the secret.
   */
  async setCredential(
    agentId: string,
    accountId: string,
    body: SetAgentAccountCredentialRequest,
  ): ServiceResult<AgentAccountView> {
    await this.requireAccount(agentId, accountId);

    await (await this.identity()).setCredential(accountId, body.credential, body.hint);

    return this.requireAccount(agentId, accountId);
  }

  /** Release the account on the provider side and mark it revoked. */
  async revokeAccount(
    agentId: string,
    accountId: string,
    query: RevokeAgentAccountQuery,
  ): ServiceResult<AgentAccountView> {
    await this.requireAccount(agentId, accountId);

    await (
      await this.identity()
    ).revoke(accountId, {
      purgeCredential: query.purgeCredential,
      release: query.release,
    });

    return this.requireAccount(agentId, accountId);
  }
}
