import type {
  BuiltinServerRuntimeOutput,
  ChannelPostedMessage,
  ChannelPostMessageParams,
} from '@lobechat/types';

/**
 * Posting as the run's own Agent elsewhere than where it answers, with the cards it drew; the
 * runtime binds the run and tool call.
 */
export interface ChannelPostingService {
  postMessage: (params: ChannelPostMessageParams) => Promise<ChannelPostedMessage>;
}

export const postChannelMessage = async (
  posting: ChannelPostingService | undefined,
  params: ChannelPostMessageParams,
): Promise<BuiltinServerRuntimeOutput> => {
  try {
    if (!posting) throw new Error('Posting is not available in this run');
    const state = await posting.postMessage(params);
    return { content: JSON.stringify(state), state, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not post that message';
    return { content: message, error: { type: 'ChannelPostError', message }, success: false };
  }
};
