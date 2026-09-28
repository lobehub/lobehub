import { LOADING_FLAT } from '@lobechat/const';
import type { ChatToolResult } from '@lobechat/types';

/**
 * Did this tool actually produce a result body?
 *
 * Shared by every "is this tool finished" test, because the honest answer is no
 * longer `!!result.content`: the read path can replace a settled tool's body
 * with a render-facing view model, leaving `content` empty and the real length
 * in `contentLength`. Reading the body alone flips a finished tool back into
 * its loading placeholder for as long as the assistant message is busy.
 */
export const hasToolResultBody = (result?: Pick<ChatToolResult, 'content' | 'contentLength'>) => {
  if (!result || result.content === LOADING_FLAT) return false;

  return !!result.content || (result.contentLength ?? 0) > 0;
};
