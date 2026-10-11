import type {
  AgentAccountCapabilities,
  AgentAccountCredentialHint,
  AgentAccountInboundMessage,
  AgentAccountInboundRequest,
  AgentAccountKind,
  AgentAccountOutboundMessage,
  AgentAccountRef,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { AgentModel } from '@/database/models/agent';
import type {
  AgentAccountGateKeeper,
  AgentAccountPatch,
  AgentAccountView,
} from '@/database/models/agentAccount';
import { AgentAccountModel, ROUTING_KEY_HELD_STATUSES } from '@/database/models/agentAccount';
import type { LobeChatDatabase } from '@/database/type';
import { unwrapPgError } from '@/server/modules/AgentRuntime/pgError';

import { AgentAccountError } from './errors';
import type { AgentAccountProviderRegistry } from './registry';

const PG_UNIQUE_VIOLATION = '23505';

export type { AgentAccountErrorCode } from './errors';
export { AgentAccountError, isAgentAccountError } from './errors';

/** Fields a caller may set when mounting an account it already has a handle for. */
export interface CreateAgentAccountParams {
  agentId: string;
  /**
   * What the account can do. Optional when `provider` is registered — the
   * provider's declaration is used — but required for an unregistered provider
   * (e.g. `user`), because nothing else can state it.
   */
  capabilities?: AgentAccountCapabilities;
  /** Write-only secret. Encrypted before it ever reaches the row. */
  credential?: Record<string, string>;
  credentialHint?: AgentAccountCredentialHint;
  displayName?: string;
  identifier: string;
  kind: AgentAccountKind;
  metadata?: Record<string, unknown>;
  provider: string;
}

/** Ask a provider to issue a brand-new account for the agent. */
export interface ProvisionAgentAccountParams {
  agentId: string;
  displayName?: string;
  /** Preferred handle for the new account, when the provider can honour one. */
  prefix?: string;
  provider: string;
}

export interface RevokeAgentAccountOptions {
  /** Also purge the stored credential. Default `true`. */
  purgeCredential?: boolean;
  /** Ask the provider to release its side first. Default `true`. */
  release?: boolean;
}

/** What `handleInbound` decided, so the webhook route can pick a status code. */
export type AgentAccountInboundOutcome =
  | {
      accountId: string;
      /** Provider delivery id, so a failed handling can release its replay claim. */
      eventId: string;
      message: AgentAccountInboundMessage;
      outcome: 'delivered';
    }
  | { accountId?: string; outcome: 'ignored' | 'rejected' | 'unknown-account' | 'unroutable' };

export interface AgentAccountServiceOptions {
  gateKeeper?: AgentAccountGateKeeper;
  registry: AgentAccountProviderRegistry;
  workspaceId?: string;
}

/**
 * Identity service: the one place that turns an `agent_accounts` row into
 * provider behaviour and back.
 *
 * It owns the orchestration only — resolve a provider, apply the credential
 * discipline the model enforces, and persist the provider's capability
 * declaration onto the row. All protocol detail lives in the provider; all
 * storage and scoping lives in {@link AgentAccountModel}.
 */
export class AgentAccountService {
  private readonly model: AgentAccountModel;
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly options: AgentAccountServiceOptions;

  constructor(db: LobeChatDatabase, userId: string, options: AgentAccountServiceOptions) {
    this.db = db;
    this.userId = userId;
    this.options = options;
    this.model = new AgentAccountModel(db, userId, options.gateKeeper, options.workspaceId);
  }

  // --------------- Reads (never return a credential) ---------------

  list = (query?: {
    agentId?: string;
    kind?: AgentAccountKind;
    provider?: string;
  }): Promise<AgentAccountView[]> => this.model.query(query);

  get = (id: string): Promise<AgentAccountView | undefined> => this.model.findById(id);

  /**
   * Whether this deployment has the named provider registered. The inbound
   * edge asks before dispatching so an unknown provider is a 404 (a webhook
   * URL nobody configured) rather than the registry's thrown error read as a
   * 500.
   */
  hasProvider = (provider: string): boolean => this.options.registry.has(provider);

  // --------------- Writes ---------------

  /**
   * Mount an account whose handle already exists (a `user`-provided login, or
   * one issued out of band). Prefer {@link provision} when a provider can mint
   * the account itself.
   */
  create = async (params: CreateAgentAccountParams): Promise<AgentAccountView> => {
    await this.assertAgentOwned(params.agentId);

    const capabilities = params.capabilities ?? this.declaredCapabilities(params.provider);
    if (!capabilities) {
      throw new Error(
        `Agent account provider "${params.provider}" is not registered, so its capabilities cannot ` +
          'be inferred. Pass capabilities explicitly when creating an account for an unregistered provider.',
      );
    }

    try {
      return await this.model.create({
        agentId: params.agentId,
        capabilities,
        credential: params.credential,
        credentialHint: params.credentialHint,
        displayName: params.displayName ?? null,
        identifier: params.identifier,
        kind: params.kind,
        metadata: params.metadata ?? {},
        provider: params.provider,
        // The handle already exists, so the account is usable as written; the
        // column default `provisioning` is for rows written ahead of the handle.
        status: 'active',
      });
    } catch (error) {
      throw this.toConflictError(error, params.provider, params.identifier) ?? error;
    }
  };

  /**
   * Open a new account through its provider and persist it. The account's kind
   * and capabilities come from the provider's declaration, never from the
   * caller — a provider is the only thing that knows what it issues.
   */
  provision = async (params: ProvisionAgentAccountParams): Promise<AgentAccountView> => {
    // Before the provider is asked to open anything: a refused caller must not
    // be able to make us create a remote inbox or bind a number at all.
    await this.assertAgentOwned(params.agentId);

    const provider = this.options.registry.get(params.provider);
    const issued = await provider.provision({
      agentId: params.agentId,
      displayName: params.displayName,
      prefix: params.prefix,
      userId: this.userId,
      workspaceId: this.options.workspaceId,
    });

    try {
      return await this.model.create({
        agentId: params.agentId,
        capabilities: provider.capabilities,
        credential: issued.credential,
        credentialHint: issued.credentialHint,
        displayName: issued.displayName ?? params.displayName ?? null,
        identifier: issued.identifier,
        kind: provider.kind,
        metadata: issued.metadata ?? {},
        provider: provider.provider,
        // A provider opens the account synchronously: `provision` only returns
        // once the handle exists and is reachable, so the row is live from the
        // first read. Leaving it `provisioning` would tell the user their new
        // address is still opening while it is already able to receive.
        status: 'active',
      });
    } catch (error) {
      const conflict = this.toConflictError(error, provider.provider, issued.identifier);

      // Two very different failures land here, and the routing key settles both:
      //
      // - a unique violation means a live row already holds the handle. On an
      //   idempotent provisioning retry that row is *this* account — the provider
      //   contract makes `provision` idempotent, so it can hand back the very
      //   inbox already backing the live row — and the first write simply
      //   committed;
      // - any other error leaves the write's outcome unknown: the insert may have
      //   committed and only its acknowledgement been lost.
      //
      // Only a live row counts. A released handle can be bound again, so the key
      // may carry both the revoked row and its replacement; reconciling against
      // the replaced one would release the resource the live account is using.
      // If even the lookup fails, keep the resource — an orphaned inbox can be
      // reaped, a broken account cannot be repaired by the user.
      let committed: AgentAccountView | undefined;
      try {
        committed = await AgentAccountModel.findByRoutingKey(
          this.db,
          provider.provider,
          issued.identifier,
          ROUTING_KEY_HELD_STATUSES,
        );
      } catch {
        throw conflict ?? error;
      }
      if (committed && committed.agentId === params.agentId) return committed;

      // The provider holds a resource (an inbox) that no live
      // row of this agent points at. Hand it back so a failed write leaves
      // nothing billable behind; the release is best-effort because the original
      // error is the one worth surfacing.
      await provider
        .release({
          credential: issued.credential ?? null,
          // No row was written, so there is no account id to hand over.
          id: '',
          identifier: issued.identifier,
          kind: provider.kind,
          metadata: issued.metadata ?? {},
          provider: provider.provider,
        })
        .catch(() => undefined);

      throw conflict ?? error;
    }
  };

  /**
   * Patch the non-secret fields.
   *
   * `status` is deliberately not patchable: writing it here would free the
   * routing handle (the partial unique indexes stop counting revoked rows)
   * while skipping the provider release, the credential purge and `revokedAt`
   * — and could equally revive a row that had already been released. Lifecycle
   * moves through {@link revoke}.
   */
  update = async (id: string, patch: AgentAccountPatch): Promise<string | undefined> => {
    if ('status' in patch) {
      throw new Error(
        'Agent account status is not patchable; release the account through `revoke` instead.',
      );
    }

    return this.model.update(id, patch);
  };

  /** Install or rotate a credential. Write-only: nothing reads it back out here. */
  setCredential = (
    id: string,
    credential: Record<string, string>,
    hint?: Omit<AgentAccountCredentialHint, 'rotatedAt'>,
  ): Promise<string | undefined> => this.model.setCredential(id, credential, hint);

  /**
   * Release the account on the provider side (when it is registered) and mark
   * the row revoked. Revocation always succeeds even if the provider is no
   * longer configured — a deployment that lost a key must still be able to
   * revoke the accounts it issued.
   */
  revoke = async (
    id: string,
    options: RevokeAgentAccountOptions = {},
  ): Promise<string | undefined> => {
    const release = options.release ?? true;
    const account = await this.model.findById(id);
    if (!account) return undefined;

    if (release && this.options.registry.has(account.provider)) {
      const credential = await this.model.getCredential(id);
      await this.options.registry.get(account.provider).release(this.toRef(account, credential));
    }

    return this.model.revoke(id, { purgeCredential: options.purgeCredential });
  };

  // --------------- Provider actions ---------------

  /** Send from one of the agent's accounts through its provider. */
  send = async (
    accountId: string,
    message: AgentAccountOutboundMessage,
  ): Promise<{ providerMessageId: string }> => {
    const account = await this.requireActiveAccount(accountId);
    // The persisted capability is the account's contract (a phone line warming
    // up is receive-only), so it gates the irreversible provider call — not
    // the provider's declaration, which only seeds it at creation.
    if (!account.capabilities.send) {
      throw new Error(`Agent account ${accountId} is not allowed to send`);
    }
    const provider = this.options.registry.get(account.provider);
    const credential = await this.model.getCredential(accountId);

    return provider.send(this.toRef(account, credential), message);
  };

  /**
   * Route one inbound webhook delivery:
   *
   * 1. extract the routing identifier (untrusted) and resolve the account;
   * 2. verify the signature with that account's credential;
   * 3. normalize into the transport-neutral message.
   *
   * Only step 3's result is safe to hand onward — the earlier two answer the
   * webhook with 401/404 without producing a message.
   */
  handleInbound = async (
    providerName: string,
    request: AgentAccountInboundRequest,
  ): Promise<AgentAccountInboundOutcome> => {
    const provider = this.options.registry.get(providerName);

    const identifier = provider.resolveInboundIdentifier(request);
    if (!identifier) return { outcome: 'unroutable' };

    const resolved = await AgentAccountModel.findForInboundVerification(
      this.db,
      providerName,
      identifier,
      this.options.gateKeeper,
    );
    if (!resolved) return { outcome: 'unknown-account' };

    const ref = this.toRef(resolved.view, resolved.credential);

    const event = await provider.verifyInbound(request, ref);
    if (!event) return { accountId: resolved.view.id, outcome: 'rejected' };
    // Authentic but already handled: acknowledge so the provider stops
    // retrying, and produce nothing a second time.
    if (event.duplicate) return { accountId: resolved.view.id, outcome: 'ignored' };
    // Same contract on the way in: a send-only account acknowledges the
    // delivery but must not turn it into agent work.
    if (!resolved.view.capabilities.receive) {
      return { accountId: resolved.view.id, outcome: 'ignored' };
    }

    let message: AgentAccountInboundMessage | null;
    try {
      message = await provider.normalizeInbound(event, ref);
    } catch (error) {
      // Verified and claimed but not processed: give the event id back so the
      // provider's retry is handled instead of acknowledged as a duplicate.
      await provider.releaseInbound?.(event.eventId)?.catch(() => undefined);
      throw error;
    }
    if (!message) return { accountId: resolved.view.id, outcome: 'ignored' };

    return { accountId: resolved.view.id, eventId: event.eventId, message, outcome: 'delivered' };
  };

  /**
   * Release the replay claim of a delivery whose handling failed after
   * {@link handleInbound} accepted it, so the provider's retry is processed
   * instead of acknowledged as a duplicate.
   */
  releaseInbound = async (providerName: string, eventId: string): Promise<void> => {
    await this.options.registry.get(providerName).releaseInbound?.(eventId);
  };

  // --------------- Internals ---------------

  private declaredCapabilities = (provider: string): AgentAccountCapabilities | undefined =>
    this.options.registry.has(provider) ? this.options.registry.capabilities(provider) : undefined;

  /**
   * An account binds an address *and a credential* to an agent, so only the
   * agent's creator may attach one — the same rule `connector` and `composio`
   * apply before storing credentials against an agent.
   *
   * Visibility is deliberately not enough: a member who can merely use a shared
   * agent must not be able to mount their own mailbox, or a secret, onto it.
   * `existsOwnedById` is creator-only for exactly that reason.
   */
  private assertAgentOwned = async (agentId: string): Promise<void> => {
    const agentModel = new AgentModel(this.db, this.userId, this.options.workspaceId);
    if (!(await agentModel.existsOwnedById(agentId))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Agent not found or not editable' });
    }
  };

  /** Turn a routing-key unique violation into a refusal a person can act on. */
  private toConflictError = (
    error: unknown,
    provider: string,
    identifier: string,
  ): AgentAccountError | undefined => {
    if (unwrapPgError(error)?.code !== PG_UNIQUE_VIOLATION) return undefined;

    return new AgentAccountError(
      'identifier_taken',
      `${identifier} is already bound to another agent on ${provider}. Release that account first.`,
    );
  };

  private requireActiveAccount = async (accountId: string): Promise<AgentAccountView> => {
    const account = await this.model.findById(accountId);
    if (!account) throw new Error(`Agent account ${accountId} was not found in this scope`);
    // Same liveness rule as inbound routing: `provisioning` is usable the
    // moment the row exists, while `suspended` and `revoked` must stop the
    // irreversible provider call, not just inbound delivery.
    if (account.status !== 'active' && account.status !== 'provisioning') {
      throw new Error(`Agent account ${accountId} is ${account.status} and cannot be used`);
    }
    return account;
  };

  private toRef = (
    view: AgentAccountView,
    credential?: Record<string, string> | null,
  ): AgentAccountRef => ({
    credential,
    id: view.id,
    identifier: view.identifier,
    kind: view.kind,
    metadata: view.metadata ?? {},
    provider: view.provider,
  });
}
