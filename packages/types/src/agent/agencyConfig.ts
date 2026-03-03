/**
 * Discord Bot configuration for an agent
 */
export interface DiscordBotConfig {
  applicationId: string;
  botToken: string;
  enabled: boolean;
  publicKey: string;
}

/**
 * Slack Bot configuration for an agent
 */
export interface SlackBotConfig {
  botToken: string;
  enabled: boolean;
  signingSecret: string;
}

/**
 * Agent agency configuration for external platform bot integrations.
 * Each agent can independently configure its own bot providers.
 */
export interface LobeAgentAgencyConfig {
  discord?: DiscordBotConfig;
  slack?: SlackBotConfig;
}
