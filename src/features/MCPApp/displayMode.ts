import type { McpAppDisplayMode, McpUiResourceMeta } from '@lobechat/const/mcpApp';

export interface DisplayModeOptions {
  appModes?: readonly McpAppDisplayMode[];
  hostModes: readonly McpAppDisplayMode[];
  resourceMeta?: Pick<McpUiResourceMeta, 'availableDisplayModes' | 'preferredDisplayMode'>;
  toolPreferred?: 'inline' | 'fullscreen';
}

export const availableDisplayModes = ({ appModes, hostModes, resourceMeta }: DisplayModeOptions) =>
  hostModes.filter(
    (mode) =>
      mode !== 'pip' &&
      (!appModes || appModes.includes(mode)) &&
      (!resourceMeta?.availableDisplayModes || resourceMeta.availableDisplayModes.includes(mode)),
  );

/** Resolve a preference only after resource, host and initialized app capabilities agree. */
export const resolveDisplayMode = (options: DisplayModeOptions): McpAppDisplayMode => {
  const available = availableDisplayModes(options);
  const { resourceMeta, toolPreferred } = options;
  const dualMode =
    resourceMeta?.availableDisplayModes?.includes('inline') &&
    resourceMeta.availableDisplayModes.includes('fullscreen');
  const preferred =
    toolPreferred ?? resourceMeta?.preferredDisplayMode ?? (dualMode ? 'fullscreen' : 'inline');
  return available.includes(preferred)
    ? preferred
    : available.includes('inline')
      ? 'inline'
      : (available[0] ?? 'inline');
};

export const requestedDisplayMode = (
  current: McpAppDisplayMode,
  requested: McpAppDisplayMode,
  options: DisplayModeOptions,
) => (availableDisplayModes(options).includes(requested) ? requested : current);
