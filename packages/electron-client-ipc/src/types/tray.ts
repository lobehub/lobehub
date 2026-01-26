/**
 * Parameters for showing tray notification
 */
export interface ShowTrayNotificationParams {
  /**
   * Notification content
   */
  content: string;

  /**
   * Icon type
   */
  iconType?: 'info' | 'warning' | 'error' | 'none';

  /**
   * Notification title
   */
  title: string;
}

/**
 * Parameters for updating tray icon
 */
export interface UpdateTrayIconParams {
  /**
   * Icon path (relative to resource directory)
   */
  iconPath: string;
}

/**
 * Parameters for updating tray tooltip text
 */
export interface UpdateTrayTooltipParams {
  /**
   * Tooltip text
   */
  tooltip: string;
}
