import { type ServerConfigStore } from './store';

export const featureFlagsSelectors = (s: ServerConfigStore) => s.featureFlags;

export const serverConfigSelectors = {
  disableEmailPassword: (s: ServerConfigStore) => s.serverConfig.disableEmailPassword || false,
  enableBusinessFeatures: (s: ServerConfigStore) => s.serverConfig.enableBusinessFeatures || false,
  enableEmailVerification: (s: ServerConfigStore) =>
    s.serverConfig.enableEmailVerification || false,
  enableComposio: (s: ServerConfigStore) => s.serverConfig.enableComposio || false,
  /** Runtime flag `dashboard`: dashboards, widget previews and the lobe-dashboard tool. */
  enableChannels: (s: ServerConfigStore) => s.featureFlags.enableChannels === true,
  enableDashboard: (s: ServerConfigStore) => s.featureFlags.enableDashboard === true,
  enableGatewayMode: (s: ServerConfigStore) => s.serverConfig.enableGatewayMode || false,
  enableTopicPreview: (s: ServerConfigStore) => s.featureFlags.enableTopicPreview === true,
  enableLobehubSkill: (s: ServerConfigStore) => s.serverConfig.enableLobehubSkill || false,
  enableMagicLink: (s: ServerConfigStore) => s.serverConfig.enableMagicLink || false,
  enableMarketTrustedClient: (s: ServerConfigStore) =>
    s.serverConfig.enableMarketTrustedClient || false,
  enablePageCollab: (s: ServerConfigStore) => s.serverConfig.enablePageCollab || false,
  enableUploadFileToServer: (s: ServerConfigStore) => s.serverConfig.enableUploadFileToServer,
  /** Workspaces are available to this user (business deployment + per-user `workspace` flag). */
  enableWorkspace: (s: ServerConfigStore) =>
    (s.serverConfig.enableBusinessFeatures || false) && s.featureFlags.enableWorkspace === true,
  enableMultimodalUnderstanding: (s: ServerConfigStore) =>
    s.serverConfig.enableMultimodalUnderstanding || false,
  enabledTelemetryChat: (s: ServerConfigStore) => s.serverConfig.telemetry.langfuse || false,
  isMobile: (s: ServerConfigStore) => s.isMobile || false,
  oAuthSSOProviders: (s: ServerConfigStore) => s.serverConfig.oAuthSSOProviders,
  oidcIssuer: (s: ServerConfigStore) => s.serverConfig.oidcIssuer,
  sandbox: (s: ServerConfigStore) => s.serverConfig.sandbox ?? 'market',
  multimodalUnderstanding: (s: ServerConfigStore) => s.serverConfig.multimodalUnderstanding,
};
