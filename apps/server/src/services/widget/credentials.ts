import type { WidgetEnvRequirement } from '@lobechat/types';

import { ConnectorModel, type DecryptedConnector } from '@/database/models/connector';
import type { ConnectorCredentials } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';
import { isWorkspacePrimaryOwner } from '@/server/services/workspacePermission';

/** Ownership columns of the widget whose script needs credentials. */
export interface WidgetCredentialScope {
  agentId: string | null;
  /**
   * Who wrote the script that will receive the secrets: the publisher of the
   * version being run, or the author of a draft being dry-run. `null` when
   * that user no longer exists — then no connector may be injected.
   */
  authorUserId: string | null;
  projectId: string | null;
  userId: string;
  workspaceId: string | null;
}

export interface MissingWidgetEnv {
  connector?: string;
  name: string;
  reason: 'connector_not_connected' | 'no_source';
}

export class MissingWidgetEnvError extends Error {
  constructor(public readonly missing: MissingWidgetEnv[]) {
    super(formatMissing(missing));
    this.name = 'MissingWidgetEnvError';
  }
}

/**
 * The script's author may not read a connector they resolved: raised instead
 * of running, so the secret never reaches a script its owner did not vouch for.
 */
export class ForbiddenWidgetCredentialsError extends Error {
  constructor(public readonly connectors: string[]) {
    super(
      connectors
        .map(
          (c) =>
            `Connector "${c}" was connected by another workspace member; only its creator or the workspace owner can author a widget that reads it`,
        )
        .join('; '),
    );
    this.name = 'ForbiddenWidgetCredentialsError';
  }
}

const formatMissing = (missing: MissingWidgetEnv[]) =>
  `Missing required environment: ${missing
    .map((m) =>
      m.reason === 'no_source'
        ? `${m.name} (no connector declared to provide it)`
        : `${m.name} (connect "${m.connector}" for this widget's agent or workspace)`,
    )
    .join('; ')}`;

/** The single secret string a connector contributes to an env variable. */
export const credentialToSecret = (
  credentials: ConnectorCredentials | null,
): string | undefined => {
  if (!credentials) return undefined;
  switch (credentials.type) {
    case 'oauth2': {
      return credentials.accessToken || undefined;
    }
    case 'bearer': {
      return credentials.token || undefined;
    }
    case 'apikey': {
      return credentials.apiKey || undefined;
    }
    case 'header': {
      const [value] = Object.values(credentials.headers ?? {});
      return value?.replace(/^Bearer\s+/i, '') || undefined;
    }
  }
};

export interface ResolveWidgetEnvOptions {
  /** Injected for tests; defaults to a model on the widget's scope. */
  connectorModel?: Pick<ConnectorModel, 'resolveByIdentifiers' | 'update'>;
  /** Injected for tests; defaults to the workspace's primary-owner check. */
  isWorkspaceOwner?: (userId: string, workspaceId: string) => Promise<boolean>;
}

/**
 * Whether the script's author may receive a connector's raw secret.
 *
 * A widget script is arbitrary code that can exfiltrate whatever it is given,
 * so injecting a secret is equivalent to handing it to the script's author.
 * Workspace connectors are visible to every member, but only their creator or
 * the workspace owner may manage them (`assertWorkspaceRowManageable`); the
 * same authority is required to read one from a script:
 *
 * - the author created the connector, or
 * - the connector is workspace-level (incl. agent-scoped rows in the
 *   workspace, and the workspace connectors a project widget resolves) and
 *   the author is the workspace owner.
 *
 * Personal connectors are only ever resolved for personal widgets, whose
 * author is their owner, so the creator rule covers them. A missing author
 * (deleted user) may read nothing.
 */
const mayInject = async (
  connector: DecryptedConnector,
  scope: WidgetCredentialScope,
  isOwner: () => Promise<boolean>,
): Promise<boolean> => {
  if (!scope.authorUserId) return false;
  if (connector.userId === scope.authorUserId) return true;
  return !!connector.workspaceId && isOwner();
};

/**
 * Resolve the environment a widget script declares in `manifest.env`.
 *
 * Credentials come from `user_connectors` through the same agent-aware chain
 * agent runs use (`ConnectorModel.resolveByIdentifiers`): an agent-owned
 * connector wins over the base connector of the widget's own scope, and the
 * base scope is exactly the widget's — a workspace widget resolves within the
 * workspace, a personal widget within its owner's personal connectors. A
 * project widget has no connector level of its own and uses its workspace's.
 *
 * The widget's scope, not the caller's, decides: a member refreshing a
 * teammate's widget gets the widget's credentials, and a non-personal widget
 * never falls back to its creator's personal connectors. Whether a resolved
 * connector may be injected is decided by the script's author (see
 * {@link mayInject}), not by who triggers the run.
 *
 * Throws `ForbiddenWidgetCredentialsError` when a declared connector resolves
 * to one the author may not read, and `MissingWidgetEnvError` listing every
 * required variable it could not fill; optional ones are left out.
 */
export const resolveWidgetEnv = async (
  db: LobeChatDatabase,
  scope: WidgetCredentialScope,
  requirements: WidgetEnvRequirement[] | undefined,
  options: ResolveWidgetEnvOptions = {},
): Promise<Record<string, string>> => {
  const env: Record<string, string> = {};
  if (!requirements?.length) return env;

  const connectorModel =
    options.connectorModel ??
    new ConnectorModel(
      db,
      scope.userId,
      scope.workspaceId ?? undefined,
      await KeyVaultsGateKeeper.initWithEnvKey(),
    );

  const identifiers = [
    ...new Set(requirements.map((r) => r.connector).filter((c): c is string => !!c)),
  ];
  const resolved = identifiers.length
    ? await connectorModel.resolveByIdentifiers(identifiers, scope.agentId ?? undefined)
    : [];

  const byIdentifier = new Map<string, DecryptedConnector>();
  for (const connector of resolved) {
    // Defense in depth: the model's predicate is scope-exact, but a credential
    // from another scope must never reach a script, whatever the query does.
    if ((connector.workspaceId ?? null) !== (scope.workspaceId ?? null)) continue;
    // `status` tracks MCP tool sync, not credential validity: an API-key
    // connector that never synced tools stays `disconnected` yet holds a
    // usable secret. A revoked connector has its credentials wiped instead.
    if (!connector.isEnabled) continue;
    byIdentifier.set(connector.identifier, connector);
  }

  // Check before refreshing any token: a refused connector is never touched.
  let ownerCheck: Promise<boolean> | undefined;
  const isOwner = () => {
    if (!scope.workspaceId || !scope.authorUserId) return Promise.resolve(false);
    ownerCheck ??= options.isWorkspaceOwner
      ? options.isWorkspaceOwner(scope.authorUserId, scope.workspaceId)
      : isWorkspacePrimaryOwner({ db, userId: scope.authorUserId, workspaceId: scope.workspaceId });
    return ownerCheck;
  };
  const forbidden: string[] = [];
  for (const connector of byIdentifier.values()) {
    if (!(await mayInject(connector, scope, isOwner))) forbidden.push(connector.identifier);
  }
  if (forbidden.length > 0) throw new ForbiddenWidgetCredentialsError(forbidden);

  const missing: MissingWidgetEnv[] = [];
  for (const requirement of requirements) {
    const required = requirement.required !== false;
    if (!requirement.connector) {
      if (required) missing.push({ name: requirement.name, reason: 'no_source' });
      continue;
    }

    let connector = byIdentifier.get(requirement.connector);
    if (connector) {
      connector = await ensureFreshConnectorToken(connector, connectorModel as ConnectorModel);
    }
    const secret = credentialToSecret(connector?.credentials ?? null);
    if (secret) {
      env[requirement.name] = secret;
    } else if (required) {
      missing.push({
        connector: requirement.connector,
        name: requirement.name,
        reason: 'connector_not_connected',
      });
    }
  }

  if (missing.length > 0) throw new MissingWidgetEnvError(missing);
  return env;
};
