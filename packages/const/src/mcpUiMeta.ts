/** Wire metadata is untrusted. These parsers only retain supported, valid fields. */
export type McpAppDisplayMode = 'inline' | 'fullscreen' | 'pip';
export interface McpAppQuickAction {
  icons: { mimeType?: string; sizes?: string[]; src: string; theme?: 'light' | 'dark' }[];
  target: { arguments?: Record<string, unknown>; name: string; type: 'tool' };
  title: string;
}
export type McpAppEntrypoint =
  | { type: 'thread' }
  | { quickAction?: McpAppQuickAction; type: 'global' }
  | { extensions: string[]; type: 'file' };

export interface McpUiToolMeta {
  entrypoints?: McpAppEntrypoint[];
  preferredModelDisplayMode?: 'inline' | 'fullscreen';
  resourceUri?: string;
  visibility?: string[];
}

export interface McpUiResourceMeta {
  availableDisplayModes?: McpAppDisplayMode[];
  csp?: {
    baseUriDomains?: string[];
    connectDomains?: string[];
    frameDomains?: string[];
    resourceDomains?: string[];
  };
  domain?: string;
  permissions?: {
    camera?: Record<string, never>;
    clipboardWrite?: Record<string, never>;
    geolocation?: Record<string, never>;
    microphone?: Record<string, never>;
  };
  preferredDisplayMode?: McpAppDisplayMode;
  prefersBorder?: boolean;
}

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;

const displayMode = (value: unknown): McpAppDisplayMode | undefined =>
  value === 'inline' || value === 'fullscreen' || value === 'pip' ? value : undefined;

const entrypoints = (value: unknown): McpAppEntrypoint[] | undefined => {
  if (!Array.isArray(value) || value.length > 3) return;
  return value.flatMap((entry): McpAppEntrypoint[] => {
    if (entry?.type === 'thread') return [{ type: 'thread' }];
    if (entry?.type === 'global') {
      const action = entry.quickAction as McpAppQuickAction | undefined;
      if (action === undefined) return [{ type: 'global' }];
      if (
        typeof action?.title !== 'string' ||
        !action.title.trim() ||
        action.target?.type !== 'tool' ||
        typeof action.target.name !== 'string' ||
        !action.target.name.trim() ||
        !Array.isArray(action.icons) ||
        !action.icons.length ||
        action.icons.some((icon) => typeof icon?.src !== 'string')
      )
        return [];
      return [{ type: 'global', quickAction: action }];
    }
    if (
      entry?.type === 'file' &&
      Array.isArray(entry.extensions) &&
      entry.extensions.every((v: unknown) => typeof v === 'string' && v.trim().startsWith('.'))
    )
      return [{ type: 'file', extensions: [...entry.extensions] }];
    return [];
  });
};

/** Callers must opt in to compatibility only when their mcp_apps gate is enabled. */
export const resolveMcpUiToolMeta = (input: unknown, enabled = true): McpUiToolMeta => {
  const meta = input as Record<string, unknown> | undefined;
  const ui = meta?.ui as Record<string, unknown> | undefined;
  const uri =
    ui?.resourceUri ??
    meta?.['ui/resourceUri'] ??
    (enabled ? meta?.['openai/outputTemplate'] : undefined);
  let visibility = strings(ui?.visibility);
  if (enabled && ui?.visibility === undefined) {
    if (meta?.['openai/visibility'] === 'private') visibility = ['app'];
    else if (meta?.['openai/widgetAccessible'] === true) visibility = ['model', 'app'];
  }
  const result: McpUiToolMeta = {
    ...(typeof uri === 'string' && uri.startsWith('ui://') && { resourceUri: uri }),
    ...(visibility && { visibility }),
  };
  if (!enabled) return result;
  // Merge declared fields before validation: an invalid override is discarded, never resurrected.
  const extension = {
    ...(meta?.['openai/ui'] as object),
    ...(meta?.['lobehub/ui'] as object),
  } as Record<string, unknown>;
  const mode = displayMode(extension.preferredModelDisplayMode);
  if (mode === 'inline' || mode === 'fullscreen') result.preferredModelDisplayMode = mode;
  const entries = entrypoints(extension.entrypoints);
  if (entries) result.entrypoints = entries;
  return result;
};

export const resolveMcpUiResourceMeta = (input: unknown): McpUiResourceMeta => {
  const meta = input as Record<string, unknown> | undefined;
  const ui = meta?.ui as Record<string, unknown> | undefined;
  const legacyCsp = meta?.['openai/widgetCSP'] as Record<string, unknown> | undefined;
  const csp = (ui?.csp ??
    (legacyCsp && {
      connectDomains: legacyCsp.connect_domains,
      frameDomains: legacyCsp.frame_domains,
      resourceDomains: legacyCsp.resource_domains,
    })) as Record<string, unknown> | undefined;
  const result: McpUiResourceMeta = {};
  if (csp && typeof csp === 'object' && !Array.isArray(csp)) {
    result.csp = {};
    for (const key of [
      'connectDomains',
      'resourceDomains',
      'frameDomains',
      'baseUriDomains',
    ] as const) {
      const domains = strings(csp[key]);
      if (domains) result.csp[key] = domains;
    }
  }
  const permissions = ui?.permissions as Record<string, unknown> | undefined;
  if (permissions && typeof permissions === 'object' && !Array.isArray(permissions)) {
    result.permissions = {};
    for (const key of ['camera', 'microphone', 'geolocation', 'clipboardWrite'] as const) {
      const value = permissions[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) result.permissions[key] = {};
    }
  }
  const domain = ui?.domain ?? meta?.['openai/widgetDomain'];
  if (typeof domain === 'string') result.domain = domain;
  const border = ui?.prefersBorder ?? meta?.['openai/widgetPrefersBorder'];
  if (typeof border === 'boolean') result.prefersBorder = border;
  const extension = {
    ...(meta?.['openai/ui'] as object),
    ...(meta?.['lobehub/ui'] as object),
  } as Record<string, unknown>;
  const mode = displayMode(extension.preferredDisplayMode);
  if (mode) result.preferredDisplayMode = mode;
  if (Array.isArray(extension.availableDisplayModes))
    result.availableDisplayModes = [
      ...new Set(
        extension.availableDisplayModes.flatMap((value) =>
          displayMode(value) ? [displayMode(value)!] : [],
        ),
      ),
    ];
  return result;
};
