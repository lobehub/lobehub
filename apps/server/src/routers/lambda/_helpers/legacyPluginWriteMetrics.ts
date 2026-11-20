import { CURRENT_VERSION } from '@lobechat/const';
import { legacyPluginWriteCounter } from '@lobechat/observability-otel/modules/legacy-plugin-write';
import type { ClientMetadata } from '@lobechat/utils/server';

export type LegacyPluginWriteProcedure = 'createOrInstallPlugin' | 'createPlugin';

/**
 * Release versions (`1.2.3`, `2.0.0-canary.4`, `0.0.0-nightly.pr1.2`),
 * capturing major and minor: only those reach a label.
 */
const RELEASE_VERSION_PATTERN = /^v?(\d{1,4})\.(\d{1,4})\.\d{1,6}(?:-[\d.a-z]{1,40})?$/i;

const toReleaseLine = (version: string): [major: number, minor: number] | undefined => {
  const match = RELEASE_VERSION_PATTERN.exec(version);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
};

/**
 * The client's release line, bounded by this server's own version. The version
 * comes from a request header, so the label set must not grow with what
 * clients send:
 *
 * - `2.0` … `2.3` (for a 2.3.x server): a release line of the server's major,
 *   pre-release and patch dropped;
 * - `older`: an older major; `newer`: past what this server ships;
 * - `other`: not a release version; `none`: no version sent.
 */
export const toClientVersionLabel = (
  version: string | undefined,
  serverVersion: string = CURRENT_VERSION,
): string => {
  if (!version) return 'none';
  const client = toReleaseLine(version);
  const server = toReleaseLine(serverVersion);
  if (!client || !server) return 'other';

  const [major, minor] = client;
  const [serverMajor, serverMinor] = server;
  if (major < serverMajor) return 'older';
  if (major > serverMajor || minor > serverMinor) return 'newer';
  return `${major}.${minor}`;
};

/**
 * Count one call to a legacy plugin create route, so deleting the routes can
 * wait until released clients have stopped calling them.
 */
export const recordLegacyPluginWrite = (
  procedure: LegacyPluginWriteProcedure,
  pluginType: 'customPlugin' | 'plugin',
  clientMetadata: ClientMetadata | undefined,
) => {
  legacyPluginWriteCounter.add(1, {
    client_type: clientMetadata?.type ?? 'unknown',
    client_version: toClientVersionLabel(clientMetadata?.version),
    plugin_type: pluginType,
    procedure,
  });
};
