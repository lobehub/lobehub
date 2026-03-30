import type { UIChatMessage } from '@lobechat/types';

// Marks messages that should be rendered locally but never forwarded into the
// real send pipeline or persisted to the database.
export const LOCAL_MESSAGE_SCOPE = '__internal_local__';

export const isLocalOnlyMessage = (message: UIChatMessage | undefined) =>
  message?.metadata?.scope === LOCAL_MESSAGE_SCOPE;
