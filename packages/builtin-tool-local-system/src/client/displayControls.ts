import type { ReadFileState } from '@lobechat/tool-runtime';
import type { RenderDisplayControl } from '@lobechat/types';

import { LocalSystemApiName } from '../types';

/**
 * The read API answers to two names: `readFile` going forward, and the legacy
 * `readLocalFile` that older gateways emit and that persisted results still
 * carry — `LocalSystemRenders` keeps the alias registered for exactly those
 * historical messages, and the local-system execution runtime normalizes the
 * same pair before dispatch (`LEGACY_API_ALIASES`). A display control that only
 * answers for the modern name leaves an image read from the legacy path
 * collapsed while its modern twin opens, so both names are the same API here.
 */
const READ_FILE_API_NAMES: readonly string[] = [LocalSystemApiName.readFile, 'readLocalFile'];

/**
 * Display control for the shared `readFile` card, refined by what was read.
 *
 * `readFile` serves two incomparable payloads, so one static default can only be
 * wrong for one of them:
 *
 *  - source / document text stays collapsed, because auto-opening it would dump
 *    a whole file into the transcript on every read;
 *  - an image file is the one case where the payload IS the point of the call —
 *    collapsing it hides the thing the agent just looked at, and the user has to
 *    click to unfold a single picture.
 *
 * Gated on an actually-uploaded image: `pluginState` is undefined while the call
 * is in flight, a text read never carries `images`, and a failed upload leaves
 * no `url`. In any of those the card would open empty, so it stays collapsed.
 */
export const resolveLocalSystemRenderDisplayControl = (
  apiName: string,
  pluginState?: unknown,
): RenderDisplayControl | undefined => {
  if (!READ_FILE_API_NAMES.includes(apiName)) return undefined;

  const images = (pluginState as Partial<ReadFileState> | undefined)?.images;

  return images?.some((image) => !!image.url) ? 'expand' : undefined;
};
