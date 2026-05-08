export const ToolErrorType = {
  PluginSettingsInvalid: 'PluginSettingsInvalid',
} as const;

export type IToolErrorType = (typeof ToolErrorType)[keyof typeof ToolErrorType];
