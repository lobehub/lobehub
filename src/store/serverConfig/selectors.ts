import { type ServerConfigStore } from './store';

export const featureFlagsSelectors = (s: ServerConfigStore) => s.featureFlags;

export const serverConfigSelectors = {
  enableEmailVerification: (s: ServerConfigStore) =>
    s.serverConfig.enableEmailVerification || false,
  enableKlavis: (s: ServerConfigStore) => s.serverConfig.enableKlavis || false,
  enableMagicLink: (s: ServerConfigStore) => s.serverConfig.enableMagicLink || false,
  enableMarketTrustedClient: (s: ServerConfigStore) =>
    s.serverConfig.enableMarketTrustedClient || false,
  enableUploadFileToServer: (s: ServerConfigStore) => s.serverConfig.enableUploadFileToServer,
  enabledAccessCode: (s: ServerConfigStore) => !!s.serverConfig?.enabledAccessCode,
  enabledTelemetryChat: (s: ServerConfigStore) => s.serverConfig.telemetry.langfuse || false,
  isMobile: (s: ServerConfigStore) => s.isMobile || false,
  oAuthSSOProviders: (s: ServerConfigStore) => s.serverConfig.oAuthSSOProviders,
};
