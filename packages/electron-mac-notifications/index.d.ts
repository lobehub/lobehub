export interface MacNotificationSender {
  avatarDataUrl?: string;
  conversationId: string;
  name: string;
}

export interface ShowMacNotificationOptions {
  body: string;
  id?: string;
  sender?: MacNotificationSender;
  silent?: boolean;
  /** File name registered under the bundle's `Library/Sounds`; system default when absent. */
  soundName?: string;
  title: string;
}

export interface ShowMacNotificationResult {
  id: string;
  ok: boolean;
  reason?: string;
}

export interface MacNotificationEvent {
  error?: string;
  id: string;
  type: 'clicked' | 'failed' | 'shown';
}

export type MacNotificationAuthorizationStatus =
  'authorized' | 'denied' | 'notDetermined' | 'provisional' | 'unsupported';

export function isSupported(): boolean;
export function showNotification(
  options: ShowMacNotificationOptions,
): Promise<ShowMacNotificationResult>;
export function onNotificationEvent(listener: (event: MacNotificationEvent) => void): () => void;
export type MacNotificationSoundSetting = 'disabled' | 'enabled' | 'unsupported';

export function getAuthorizationStatus(): Promise<MacNotificationAuthorizationStatus>;
export function getSoundSetting(): Promise<MacNotificationSoundSetting>;
export function requestAuthorization(): Promise<boolean>;
