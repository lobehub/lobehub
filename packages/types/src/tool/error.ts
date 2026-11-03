export const ToolErrorType = {
  PluginSettingsInvalid: 'PluginSettingsInvalid',
} as const;

export type IToolErrorType = (typeof ToolErrorType)[keyof typeof ToolErrorType];

/** Stable reasons carried in tRPC's `data.errorData.code`. */
export const ConnectorErrorCode = {
  StdioDesktopOnly: 'StdioDesktopOnly',
} as const;
