import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('server-services-legacy-plugin-write');

/**
 * Calls to the 1.0 plugin create routes (`plugin.createPlugin`,
 * `plugin.createOrInstallPlugin`). Current clients install MCP servers as
 * connectors, so what is left here is released clients that still write
 * `user_installed_plugins` rows. Deleting the routes waits until this series is
 * close to zero.
 *
 * Labels are small closed sets only: `procedure`, `plugin_type`
 * (plugin|customPlugin), `client_type` (desktop|mobile|web|unknown) and
 * `client_version` (a release line such as `2.3` up to the server's own,
 * `older`, `newer`, `other` or `none`). Never a user, workspace or plugin
 * identifier.
 */
export const legacyPluginWriteCounter = meter.createCounter('legacy_plugin_write_calls_total', {
  description: 'Calls to the legacy plugin create routes, by procedure and client.',
  unit: '{call}',
});
