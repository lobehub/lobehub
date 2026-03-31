interface ChannelConfigFormState {
  applicationId?: string;
  credentials?: Record<string, string>;
  settings?: Record<string, unknown> | null;
}

interface ChannelFormSettings {
  [key: string]: {} | undefined;
}

const normalizeSettings = (settings?: Record<string, unknown> | null): ChannelFormSettings =>
  Object.fromEntries(
    Object.entries(settings || {}).map(([key, value]) => [key, value ?? undefined]),
  );

export const getChannelFormValues = (config: ChannelConfigFormState) => ({
  applicationId: config.applicationId || '',
  credentials: config.credentials || {},
  settings: normalizeSettings(config.settings),
});
