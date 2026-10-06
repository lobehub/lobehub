/** One entry of a channel export file, as it arrives from disk. */
export interface ChannelImportItem {
  applicationId?: string;
  credentials?: Record<string, string>;
  enabled?: boolean;
  platform?: string;
  settings?: Record<string, unknown>;
}

export interface ChannelImportStep {
  applicationId: string;
  /** `undefined` leaves the server default; `false` lands an unusable draft. */
  connect: boolean;
  credentials: Record<string, string>;
  enabled: boolean | undefined;
  platform: string;
  settings: Record<string, unknown> | undefined;
}

/**
 * Decide what each entry of an import file should become.
 *
 * Exports carry credentials, but a hand-trimmed or legacy file may not, and
 * refusing the whole file over one such entry is worse than landing it. What a
 * credential-less entry must never become is a live channel: it cannot work, so
 * it arrives switched off, as a draft to finish rather than a broken
 * integration that looks connected.
 */
export const planChannelImport = (items: ChannelImportItem[]): ChannelImportStep[] =>
  items.map((item) => {
    const credentials = item.credentials ?? {};
    const hasCredentials = Object.keys(credentials).length > 0;

    return {
      applicationId: item.applicationId!,
      connect: Boolean(item.enabled) && hasCredentials,
      credentials,
      enabled: hasCredentials ? undefined : false,
      platform: item.platform!,
      settings: item.settings ?? undefined,
    };
  });

/** An entry without these cannot be created at all. */
export const isImportableChannel = (item: ChannelImportItem): boolean =>
  Boolean(item.platform && item.applicationId);
