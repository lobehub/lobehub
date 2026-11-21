import { ChannelError } from '@/database/repositories/channel';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Whether Channels are enabled for this user (runtime flag `channel`, off by default). The
 * coordinator is deliberately not gated: work already queued finishes while the flag is off.
 */
export const isChannelEnabled = async (userId?: string) =>
  (await getServerFeatureFlagsStateFromRuntimeConfig(userId)).enableChannels === true;

/** Refuse every Channel call, including Agent history reads, while the flag is off. */
export const assertChannelEnabled = async (userId: string) => {
  if (!(await isChannelEnabled(userId)))
    throw new ChannelError('FORBIDDEN', 'Channels are not enabled for this account');
};
