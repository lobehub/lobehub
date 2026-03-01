export interface PlatformBot {
  readonly applicationId: string;
  readonly platform: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export type PlatformBotClass = new (config: any) => PlatformBot;
