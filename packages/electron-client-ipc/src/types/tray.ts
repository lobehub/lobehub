export interface TrayAgentItem {
  id: string;
  title: string;
  url: string;
}

export interface TrayNavigationItem {
  subtitle?: string;
  title: string;
  url: string;
}

export interface TrayActiveTopicItem extends TrayNavigationItem {
  status: 'running' | 'waitingForHuman';
}

export interface TrayNavigationSnapshot {
  // Optional: an OTA-updated renderer and the main process can ship different versions.
  activeTopics?: TrayActiveTopicItem[];
  agents: TrayAgentItem[];
  pinned: TrayNavigationItem[];
  recent: TrayNavigationItem[];
}

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
   * Icon path (relative to resources directory)
   */
  iconPath: string;
}

/**
 * Parameters for updating tray tooltip
 */
export interface UpdateTrayTooltipParams {
  /**
   * Tooltip text
   */
  tooltip: string;
}
