import {
  assembleLocalAcceptance,
  localAcceptanceComments,
} from '@lobechat/utils/verify/localAcceptance';

import { resolveAcceptanceDir } from './acceptanceDir';
import { loadLocalAcceptance } from './localAcceptance';

/**
 * Whether a `view` / `feedback` argument names a local acceptance (or one of
 * its rounds) rather than a LobeHub acceptance id or `type:id` subject.
 */
export const localAcceptanceTarget = (ref: string): string | undefined =>
  /[\\/]/.test(ref) || ref.startsWith('.') ? resolveAcceptanceDir(ref) : undefined;

/**
 * A local acceptance read the way `acceptance.getBundle` and
 * `acceptanceComment.list` answer for a published one — same union, same
 * review overlay — so the commands that read feedback need no second code path.
 */
export const readLocalBundle = (target: string, options: { reviewsFile?: string } = {}) => {
  const read = loadLocalAcceptance(target, { reviewsFile: options.reviewsFile });
  return {
    bundle: assembleLocalAcceptance(read.source),
    comments: localAcceptanceComments(read.source),
    read,
  };
};
