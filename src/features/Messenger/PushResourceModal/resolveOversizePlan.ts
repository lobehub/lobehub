import {
  MESSENGER_ATTACHMENT_BUDGETS,
  MESSENGER_MAX_COMPRESSION_SOURCE_BYTES,
} from '@lobechat/const';

import type { MessengerPlatform } from '../constants';
import type { MessengerAttachmentType } from './resolveAttachmentType';

export interface OversizePlan {
  /** The byte cap this attachment is measured against, for the copy. */
  limit: number;
  /**
   * Whether the sender gets to pick between a recompressed image and a link.
   *
   * Only an image the server will actually attempt to recompress earns a
   * choice. Offering one anywhere else states a consequence that does not
   * happen: a non-image has no smaller representation, and an image past
   * `MESSENGER_MAX_COMPRESSION_SOURCE_BYTES` is refused before the re-encode,
   * so "compress it" would behave exactly like "send a link".
   */
  offersChoice: boolean;
  /** Whether the attachment is over its platform budget at all. */
  oversize: boolean;
}

/**
 * Decide what the push modal may promise about one attachment.
 *
 * Kept out of the component and off the same constants the server reads, so the
 * two cannot drift into telling the sender different stories.
 */
export const resolveOversizePlan = ({
  attachmentType,
  platform,
  size,
}: {
  attachmentType: MessengerAttachmentType;
  platform: MessengerPlatform;
  size?: number;
}): OversizePlan => {
  const budget = MESSENGER_ATTACHMENT_BUDGETS[platform];
  const limit = attachmentType === 'image' ? budget.imageMaxBytes : budget.fileMaxBytes;

  // An unmeasured attachment promises nothing: the server applies the same
  // budget on send, but there is no size here to state a consequence from.
  if (!size) return { limit, offersChoice: false, oversize: false };

  const oversize = size > limit;
  return {
    limit,
    offersChoice:
      oversize && attachmentType === 'image' && size <= MESSENGER_MAX_COMPRESSION_SOURCE_BYTES,
    oversize,
  };
};
