let loading: Promise<void> | undefined;

export const loadArtboardTool = () =>
  (loading ??= import('./Conversation/register').then((m) => m.registerArtboardTool()));
