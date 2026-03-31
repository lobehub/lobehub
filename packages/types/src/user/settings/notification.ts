export interface NotificationChannelSettings {
  enabled?: boolean;
  /** Per-type overrides grouped by category. Missing = use scenario default (true) */
  items?: Record<string, Record<string, boolean>>;
}

export interface NotificationSettings {
  email?: NotificationChannelSettings;
  inbox?: NotificationChannelSettings;
}
