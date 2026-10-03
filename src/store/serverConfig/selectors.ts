import { type ServerConfigStore } from './store';

export const featureFlagsSelectors = (s: ServerConfigStore) => s.featureFlags;

const EMPTY_PROVIDERS: string[] = [];

export const serverConfigSelectors = {
  agentIdentityProviders: (s: ServerConfigStore) =>
    s.serverConfig.agentIdentityProviders ?? EMPTY_PROVIDERS,
  disableEmailPassword: (s: ServerConfigStore) => s.serverConfig.disableEmailPassword || false,
  enableBusinessFeatures: (s: ServerConfigStore) => s.serverConfig.enableBusinessFeatures || false,
  enableEmailVerification: (s: ServerConfigStore) =>
    s.serverConfig.enableEmailVerification || false,
  enableComposio: (s: ServerConfigStore) => s.serverConfig.enableComposio || false,
  /** Runtime flag `dashboard`: dashboards, widget previews and the lobe-dashboard tool. */
  enableDashboard: (s: ServerConfigStore) => s.featureFlags.enableDashboard === true,
  enableGatewayMode: (s: ServerConfigStore) => s.serverConfig.enableGatewayMode || false,
  enableLobehubSkill: (s: ServerConfigStore) => s.serverConfig.enableLobehubSkill || false,
  enableMagicLink: (s: ServerConfigStore) => s.serverConfig.enableMagicLink || false,
  enableMarketTrustedClient: (s: ServerConfigStore) =>
    s.serverConfig.enableMarketTrustedClient || false,
  enableUploadFileToServer: (s: ServerConfigStore) => s.serverConfig.enableUploadFileToServer,
  enableMultimodalUnderstanding: (s: ServerConfigStore) =>
    s.serverConfig.enableMultimodalUnderstanding || false,
  enabledTelemetryChat: (s: ServerConfigStore) => s.serverConfig.telemetry.langfuse || false,
  /**
   * Whether the widget sandbox can enforce the manifest's per-host network
   * allowlist. Only `WIDGET_SANDBOX_NETWORK_FORMAT=allowlist` restricts
   * egress to the declared hosts; the default boolean format switches egress
   * on for any nonempty allowlist, so the publish review must disclose
   * unrestricted egress instead of presenting the hosts as enforced.
   */
  widgetSandboxEnforcesNetworkHosts: (s: ServerConfigStore) =>
    s.serverConfig.widgetSandboxNetworkFormat === 'allowlist',
  isMobile: (s: ServerConfigStore) => s.isMobile || false,
  oAuthSSOProviders: (s: ServerConfigStore) => s.serverConfig.oAuthSSOProviders,
  multimodalUnderstanding: (s: ServerConfigStore) => s.serverConfig.multimodalUnderstanding,
};
