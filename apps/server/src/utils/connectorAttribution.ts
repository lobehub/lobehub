import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Connector provenance helpers — "who authorized this connector".
 *
 * Every `user_connectors` row records its creator in `userId`. For Composio
 * connectors the account may have been (re)linked by a different member (e.g. a
 * workspace owner re-authorizing over a member-created row), captured in
 * `metadata.composio.linkedByUserId`. The *authorizer* — the member whose
 * credentials actually run the tool — is therefore the linker when present,
 * otherwise the row creator. Both the profile "authorized by X" tag and the
 * runtime credential-ownership note resolve attribution through here so they can
 * never drift apart.
 */

interface ConnectorAttributionRow {
  metadata?: Record<string, unknown> | null;
  userId?: string | null;
}

/** The user id whose credentials a connector runs under. `null` when unknown. */
export const resolveConnectorAuthorizerId = (connector: ConnectorAttributionRow): string | null => {
  const composio = (connector.metadata as { composio?: { linkedByUserId?: string } } | null)
    ?.composio;
  return composio?.linkedByUserId ?? connector.userId ?? null;
};

/**
 * `linkedByUserId` marks the member whose credentials a Composio tool runs under
 * — it is server-owned, written only by the OAuth connect path
 * (`upsertComposioConnector`). The generic connector create/update accepts
 * free-form `metadata`, so without a guard a member could set
 * `metadata.composio.linkedByUserId` to another user's id and spoof both the
 * attribution tag and the runtime ownership note (and shift the Composio
 * execution entity). This forces the field to the TRUSTED value — the existing
 * DB row's `linkedByUserId` on update, or dropped on create (no server value
 * yet) — ignoring whatever the client supplied. All other metadata is preserved.
 *
 * `serverMetadata` is the persisted row's metadata (pass `undefined` on create).
 * Returns the client metadata untouched when neither side has anything Composio.
 */
export const withTrustedLinkedByUserId = (
  clientMetadata: Record<string, unknown> | null | undefined,
  serverMetadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined => {
  // undefined → "leave metadata untouched"; null → "clear it". Nothing to guard.
  if (!clientMetadata) return clientMetadata;

  const serverLinked = (serverMetadata as { composio?: { linkedByUserId?: string } } | null)
    ?.composio?.linkedByUserId;
  const clientComposio = (clientMetadata as { composio?: Record<string, unknown> }).composio;

  // No composio block from the client and no trusted server value → nothing to do.
  if (!clientComposio && serverLinked === undefined) return clientMetadata;

  const composio: Record<string, unknown> = { ...clientComposio };
  if (serverLinked === undefined) delete composio.linkedByUserId;
  else composio.linkedByUserId = serverLinked;

  return { ...clientMetadata, composio };
};

export interface UserDisplayInfo {
  avatar: string | null;
  name: string | null;
}

/** Prefer full name, fall back to username. `null` when neither is set. */
const pickDisplayName = (u: { fullName: string | null; username: string | null }): string | null =>
  u.fullName || u.username || null;

/**
 * Batch-resolve a set of user ids to their display info (name + avatar), keyed
 * by id. Empty ids → empty map. Callers must only pass ids they are already
 * authorized to see (harvested from scope-checked connector rows).
 */
export const resolveUserDisplayMap = async (
  db: LobeChatDatabase,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, UserDisplayInfo>> => {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();

  const rows = await UserModel.getDisplayInfoByIds(db, ids);
  return new Map(rows.map((r) => [r.id, { avatar: r.avatar, name: pickDisplayName(r) }]));
};

export interface BorrowedConnectorRef {
  /** The member whose credentials the connector runs under (never the caller). */
  authorizerId: string;
  identifier: string;
  /** Connector display name, falling back to the identifier. */
  name: string;
}

/**
 * From the connectors resolved for a run, pick the ones authorized by a member
 * OTHER than the caller — i.e. tools the caller runs on a teammate's connected
 * account. Deduped by identifier. Empty when the caller owns every connector
 * (the typical owner-runs-own-agent case), which is the signal to inject no
 * ownership note at all.
 */
export const collectBorrowedConnectors = (
  connectors: Array<ConnectorAttributionRow & { identifier: string; name?: string | null }>,
  callerId: string,
): BorrowedConnectorRef[] => {
  const out: BorrowedConnectorRef[] = [];
  const seen = new Set<string>();
  for (const c of connectors) {
    const authorizerId = resolveConnectorAuthorizerId(c);
    if (!authorizerId || authorizerId === callerId) continue;
    if (seen.has(c.identifier)) continue;
    seen.add(c.identifier);
    out.push({ authorizerId, identifier: c.identifier, name: c.name || c.identifier });
  }
  return out;
};

/**
 * Neutralize user-editable text (connector name, member display name) before it
 * is concatenated into the system prompt: collapse newlines and drop angle
 * brackets so a crafted name can't forge a closing `</tool_credential_ownership>`
 * tag or inject its own system-level instructions, then cap the length.
 */
const sanitizeForPrompt = (value: string): string =>
  value.replaceAll(/\s+/g, ' ').replaceAll(/[<>]/g, '').trim().slice(0, 120);

/**
 * Build the system-prompt block that tells the model which of its tools run
 * under another member's credentials, so a non-owner running a shared agent
 * knows the results belong to that member (not the current user). Returns
 * `undefined` when there is nothing borrowed — nothing to inject.
 */
export const buildConnectorOwnershipPrompt = (
  borrowed: BorrowedConnectorRef[],
  displayMap: Map<string, UserDisplayInfo>,
  fallbackName = 'another member',
): string | undefined => {
  if (borrowed.length === 0) return undefined;
  const lines = borrowed.map((b) => {
    const name = displayMap.get(b.authorizerId)?.name ?? fallbackName;
    return `- ${sanitizeForPrompt(b.name)}: authorized by ${sanitizeForPrompt(name)}`;
  });
  return [
    '<tool_credential_ownership>',
    "Some tools available to you run under credentials that other workspace members authorized, not the current user. When you call one of these tools you act on that member's connected account and read their data:",
    ...lines,
    "Treat results from these tools as belonging to the authorizing member — do not assume they are the current user's own data, and say whose account a result came from when it matters.",
    '</tool_credential_ownership>',
  ].join('\n');
};
