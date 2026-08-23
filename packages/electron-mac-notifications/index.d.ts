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
export function getAuthorizationStatus(): Promise<MacNotificationAuthorizationStatus>;
export function requestAuthorization(): Promise<boolean>;
