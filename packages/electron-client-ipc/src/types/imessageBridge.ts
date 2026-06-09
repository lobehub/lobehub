export interface ImessageBridgeConfig {
  applicationId: string;
  blueBubblesPassword?: string;
  blueBubblesServerUrl: string;
  enabled: boolean;
  webhookSecret: string;
}

export interface ImessageBridgePublicConfig extends Omit<
  ImessageBridgeConfig,
  'blueBubblesPassword'
> {
  blueBubblesPasswordSet: boolean;
}

export interface ImessageBridgeStatus {
  configs: ImessageBridgePublicConfig[];
  running: boolean;
  serverUrl?: string;
}

export interface ImessageBridgeSaveResult {
  config: ImessageBridgePublicConfig;
  success: boolean;
}
