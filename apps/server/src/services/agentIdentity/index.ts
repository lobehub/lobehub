import type {
  AgentAccountCapabilities,
  AgentAccountCredentialHint,
  AgentAccountInboundEvent,
  AgentAccountInboundMessage,
  AgentAccountInboundRequest,
  AgentAccountKind,
  AgentAccountOutboundMessage,
  AgentAccountRef,
} from '@lobechat/types';

import type {
  AgentAccountGateKeeper,
  AgentAccountPatch,
  AgentAccountView,
} from '@/database/models/agentAccount';
import { AgentAccountModel, ROUTING_KEY_HELD_STATUSES } from '@/database/models/agentAccount';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { unwrapPgError } from '@/server/modules/AgentRuntime/pgError';
import {
  assertCanEditResource,
  assertCanPerformResourceAction,
} from '@/server/services/resourcePermission';

import { AgentAccountError } from './errors';
import type { AgentAccountProviderRegistry } from './registry';

const PG_UNIQUE_VIOLATION = '23505';

export type { AgentAccountErrorCode } from './errors';
export { AgentAccountError, isAgentAccountError } from './errors';

/** Fields a caller may set when mounting an account it already has a handle for. */
export interface CreateAgentAccountParams {
  agentId: string;
  /**
   * What the account can do. Required: a mounted account's provider is never a
   * registered one (those go through `provision`), so nothing else can state it.
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
  provider: string;
}

export interface RevokeAgentAccountOptions {
  /** Also purge the stored credential. Default `true`. */
  purgeCredential?: boolean;
  /** Ask the provider to release its side first. Default `true`. */
  release?: boolean;
}

/** Why an authentic delivery produced no message. */
export type AgentAccountInboundIgnoredReason = 'duplicate' | 'filtered' | 'receive-disabled';

/**
 * What `handleInbound` decided, so the webhook route can pick a status code.
 *
 * Every authentic delivery carries its verified `event`, so the caller can
 * record it as a signal — including the ones that produce no message.
 */
export type AgentAccountInboundOutcome =
  | {
      accountId: string;
      event: AgentAccountInboundEvent;
      message: AgentAccountInboundMessage;
      outcome: 'delivered';
    }
  | {
      accountId: string;
      event: AgentAccountInboundEvent;
      outcome: 'ignored';
      reason: AgentAccountInboundIgnoredReason;
    }
  | { accountId?: string; outcome: 'rejected' | 'unknown-account' | 'unroutable' };

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

  // --------------- Writes ---------------

  /**
   * Mount an account whose handle already exists (a `user`-provided login, or
   * one issued out of band) under a provider this deployment does not run.
   *
   * A registered provider's accounts are opened through {@link provision} only.
   * Its send and release act on the stored handle with the deployment-wide key,
   * so a mounted handle — an inbox id the caller merely knows — would let the
   * caller send as, or delete, a resource that was never issued to them.
   */
  create = async (params: CreateAgentAccountParams): Promise<AgentAccountView> => {
    await this.assertCanEditAgent(params.agentId);

    if (this.options.registry.has(params.provider)) {
      throw new AgentAccountError(
        'provider_managed',
        `Accounts on the "${params.provider}" provider are opened through provisioning, not mounted.`,
      );
    }

    const { capabilities } = params;
    if (!capabilities) {
      throw new AgentAccountError(
        'capabilities_required',
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
    await this.assertCanEditAgent(params.agentId);

    const provider = this.options.registry.get(params.provider);
    const issued = await provider.provision({
      agentId: params.agentId,
      displayName: params.displayName,
      isIdentifierHeld: (identifier) =>
        AgentAccountModel.isRoutingKeyHeld(this.db, provider.provider, identifier),
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
        // The provider has already issued the handle; record the terminal state.
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

      // The provider holds a resource (an inbox, a number binding) that no live
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
   *
   * `metadata` of a registered provider's account is not patchable either: it
   * holds the provider-side handles (an inbox id) that send and release act on
   * with the deployment-wide key, so rewriting it would point the account at a
   * resource it was never issued.
   */
  update = async (id: string, patch: AgentAccountPatch): Promise<string | undefined> => {
    if ('status' in patch) {
      throw new Error(
        'Agent account status is not patchable; release the account through `revoke` instead.',
      );
    }

    const account = await this.findEditable(id);
    if (!account) return undefined;

    if ('metadata' in patch && this.options.registry.has(account.provider)) {
      throw new AgentAccountError(
        'provider_owned_field',
        `Agent account metadata is owned by the "${account.provider}" provider and is not patchable.`,
      );
    }

    return this.model.update(id, patch);
  };

  /** Install or rotate a credential. Write-only: nothing reads it back out here. */
  setCredential = async (
    id: string,
    credential: Record<string, string>,
    hint?: Omit<AgentAccountCredentialHint, 'rotatedAt'>,
  ): Promise<string | undefined> => {
    if (!(await this.findEditable(id))) return undefined;

    return this.model.setCredential(id, credential, hint);
  };

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
    const account = await this.findEditable(id);
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
    // Sending is a *use* of the agent, not an edit of it. The account row is
    // scoped to the workspace and carries no visibility of its own, so the
    // model happily returns a colleague's private agent's account; without
    // this the caller would decrypt its credential and speak as that agent.
    await this.assertCanUseAgent(account.agentId);
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
    const accountId = resolved.view.id;
    if (event.duplicate) return { accountId, event, outcome: 'ignored', reason: 'duplicate' };
    // Same contract on the way in: a send-only account acknowledges the
    // delivery but must not turn it into agent work.
    if (!resolved.view.capabilities.receive) {
      return { accountId, event, outcome: 'ignored', reason: 'receive-disabled' };
    }

    const message = await provider.normalizeInbound(event, ref);
    if (!message) return { accountId, event, outcome: 'ignored', reason: 'filtered' };

    return { accountId, event, message, outcome: 'delivered' };
  };

  // --------------- Internals ---------------

  /**
   * An account binds an address *and a credential* to an agent, so writing one
   * needs the agent's effective **edit** level — the same rule the transports
   * apply, so a collaborator they admit is not refused here, and a member who
   * may merely view or use a shared agent is refused everywhere.
   *
   * Visibility first: an agent the caller cannot see answers NOT_FOUND, so the
   * ACL never becomes an oracle for a colleague's private agent. Outside a
   * workspace the visibility check alone is ownership.
   */
  private assertCanEditAgent = async (agentId: string): Promise<void> => {
    const ctx = { userId: this.userId, workspaceId: this.options.workspaceId };
    await assertAgentUsableBy(this.db, agentId, ctx);
    await assertCanEditResource({
      db: this.db,
      resourceId: agentId,
      resourceType: 'agent',
      ...ctx,
    });
  };

  /**
   * The rule for acting *through* an agent: visibility first, then the `use`
   * level. Sending from the agent's account is not an edit — a member may hold
   * `use` without holding `edit` — so this cannot reuse {@link assertCanEditAgent}.
   * Outside a workspace visibility alone is ownership, exactly as there.
   */
  private assertCanUseAgent = async (agentId: string): Promise<void> => {
    const workspaceId = this.options.workspaceId;
    const userId = this.userId;
    await assertAgentUsableBy(this.db, agentId, { userId, workspaceId });
    if (!workspaceId) return;

    await assertCanPerformResourceAction({
      action: 'use',
      db: this.db,
      resourceId: agentId,
      resourceType: 'agent',
      userId,
      workspaceId,
    });
  };

  /**
   * Load an account for a mutation, under the same edit rule as {@link create}
   * and {@link provision}. The model's scope alone is not enough: in a
   * workspace it matches every member's accounts, so without this any member
   * could rotate the creator's secret, rewrite the account or release it on
   * the provider.
   */
  private findEditable = async (id: string): Promise<AgentAccountView | undefined> => {
    const account = await this.model.findById(id);
    if (!account) return undefined;

    await this.assertCanEditAgent(account.agentId);
    return account;
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
