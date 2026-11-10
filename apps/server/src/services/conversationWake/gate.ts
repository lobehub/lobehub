import type { BotWakeConfig } from './types';

/**
 * Whether the bot-wake scenario may run for one bot.
 *
 * The gate reads the bot's own configuration. It deliberately does not consult the Labs
 * Self-evolving switch, which belongs to the self-iteration scenario.
 *
 * Returns:
 * - `true` only when the bot config enables wake and its mode is not `off`
 */
export const isBotWakeEnabled = (config: BotWakeConfig | null | undefined): boolean =>
  config?.enabled === true && config.mode !== 'off';
