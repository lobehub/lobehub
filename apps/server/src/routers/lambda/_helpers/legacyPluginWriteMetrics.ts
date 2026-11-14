import { legacyPluginWriteCounter } from '@lobechat/observability-otel/modules/legacy-plugin-write';
import type { ClientMetadata } from '@lobechat/utils/server';

export type LegacyPluginWriteProcedure = 'createOrInstallPlugin' | 'createPlugin';

/**
 * Release versions only (`1.2.3`, `2.0.0-canary.4`). The web version comes from
 * a request header, so anything else collapses into `other` instead of opening
 * a new metric series per arbitrary string.
 */
const RELEASE_VERSION_PATTERN = /^v?\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[\da-z]{1,16}(?:\.\d{1,8})?)?$/i;

export const toClientVersionLabel = (version: string | undefined): string => {
  if (!version) return 'none';

  return RELEASE_VERSION_PATTERN.test(version) ? version.replace(/^v/i, '') : 'other';
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
