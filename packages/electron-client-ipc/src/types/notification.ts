export interface ShowDesktopNotificationParams {
  body: string;
  force?: boolean;
  requestAttention?: boolean;
  silent?: boolean;
  title: string;
}

export interface DesktopNotificationResult {
  error?: string;
  reason?: string;
  skipped?: boolean;
  success: boolean;
}
