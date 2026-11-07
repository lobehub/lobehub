/**
 * Platform ids and display names without the brand icons, so route skeletons
 * (loaded with the router on first paint) can show real names without pulling
 * `@lobehub/ui/icons` into that graph.
 */
export type MessengerPlatform = 'telegram' | 'slack' | 'discord' | 'wechat' | 'linq';

export const SUPPORTED_MESSENGER_PLATFORMS = [
  { id: 'telegram', name: 'Telegram' },
  { id: 'slack', name: 'Slack' },
  { id: 'discord', name: 'Discord' },
  { id: 'wechat', name: 'WeChat' },
  { id: 'linq', name: 'iMessage' },
] as const satisfies readonly { id: MessengerPlatform; name: string }[];
