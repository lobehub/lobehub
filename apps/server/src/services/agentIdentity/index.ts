import type {
  AgentAccountCapabilities,
  AgentAccountCredentialHint,
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
import { AgentAccountModel } from '@/database/models/agentAccount';
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
  | { accountId: string; message: AgentAccountInboundMessage; outcome: 'delivered' }
  | { detail: string; outcome: 'quarantined' }
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
    const provider = this.options.registry.get(params.provider);
    const issued = await provider.provision({
      agentId: params.agentId,
      displayName: params.displayName,
      isIdentifierHeld: (identifier) =>
        AgentAccountModel.isRoutingKeyHeld(this.db, provider.provider, identifier),
      prefix: params.prefix,
      userId: this.userId,
      workspaceId: this.options.workspaceId,
    });

    let created: AgentAccountView;
    try {
      created = await this.model.create({
        agentId: params.agentId,
        // A provider may narrow its declaration per account (a number that can
        // receive now but not send until its campaign is approved).
        capabilities: issued.capabilities ?? provider.capabilities,
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
      // The provider already holds a resource (an inbox, a number binding) that
      // no row points at. Hand it back so a failed write leaves nothing billable
      // behind; the release is best-effort because the original error is the
      // one worth surfacing.
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

      throw this.toConflictError(error, provider.provider, issued.identifier) ?? error;
    }

    await provider.onProvisioned?.(this.toRef(created));
    return created;
  };

  update = (id: string, patch: AgentAccountPatch): Promise<string | undefined> =>
    this.model.update(id, patch);

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
    // The row states what the account can do; a receive-only number must not
    // be able to text just because its provider has a send call.
    if (!account.capabilities.send) {
      throw new AgentAccountError(
        'send_not_enabled',
        `${account.identifier} can receive but cannot send yet` +
          (account.metadata?.sendBlockedReason === 'messaging_campaign_not_approved'
            ? ': it is not on an approved 10DLC campaign.'
            : '.'),
      );
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
    if (!resolved) {
      // A handle the provider still holds without a live account (a number in
      // quarantine) is answered by the provider itself, never by an agent.
      const unrouted = await provider.handleUnroutedInbound?.(request);
      if (unrouted?.outcome === 'quarantined') return unrouted;
      if (unrouted?.outcome === 'rejected') return { outcome: 'rejected' };
      return { outcome: 'unknown-account' };
    }

    const ref = this.toRef(resolved.view, resolved.credential);

    const event = await provider.verifyInbound(request, ref);
    if (!event) return { accountId: resolved.view.id, outcome: 'rejected' };
    // Authentic but already handled: acknowledge so the provider stops
    // retrying, and produce nothing a second time.
    if (event.duplicate) return { accountId: resolved.view.id, outcome: 'ignored' };

    const message = await provider.normalizeInbound(event, ref);
    if (!message) return { accountId: resolved.view.id, outcome: 'ignored' };

    return { accountId: resolved.view.id, message, outcome: 'delivered' };
  };

  // --------------- Internals ---------------

  private declaredCapabilities = (provider: string): AgentAccountCapabilities | undefined =>
    this.options.registry.has(provider) ? this.options.registry.capabilities(provider) : undefined;

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
    if (account.status === 'revoked') {
      throw new Error(`Agent account ${accountId} is revoked and cannot be used`);
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
