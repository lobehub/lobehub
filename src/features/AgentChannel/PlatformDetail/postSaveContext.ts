import { createContext } from 'react';

/**
 * A side-effect a platform-specific extras component wants to run as part of
 * the main "Save Configuration" flow (after the cloud bot provider is saved).
 * Used by iMessage to persist its Desktop-only BlueBubbles bridge config in the
 * same click instead of a separate "Save Bridge" button. Throwing aborts the
 * save and surfaces the error to the user.
 */
export type ChannelPostSave = (ctx: { applicationId: string }) => Promise<void>;

export interface ChannelPostSaveRegistry {
  register: (fn: ChannelPostSave | null) => void;
}

export const ChannelPostSaveContext = createContext<ChannelPostSaveRegistry | null>(null);
