import type { DiscordChannelInfo, DiscordGuildInfo } from '@lobechat/prompts';
import { formatDiscordContext } from '@lobechat/prompts';
import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { ProcessorOptions } from '../types';

const log = debug('context-engine:provider:DiscordContextProvider');

export interface DiscordContext {
  channel?: DiscordChannelInfo;
  guild?: DiscordGuildInfo;
}

export interface DiscordContextProviderConfig {
  context?: DiscordContext;
  enabled?: boolean;
}

export class DiscordContextProvider extends BaseFirstUserContentProvider {
  readonly name = 'DiscordContextProvider';

  constructor(
    private config: DiscordContextProviderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(): string | null {
    if (!this.config.enabled || !this.config.context) {
      log('Discord context injection disabled or no context, skipping');
      return null;
    }

    const { guild, channel } = this.config.context;
    if (!guild && !channel) {
      log('No guild or channel info, skipping');
      return null;
    }

    log('Discord context prepared for injection');

    return formatDiscordContext({ channel, guild });
  }
}
