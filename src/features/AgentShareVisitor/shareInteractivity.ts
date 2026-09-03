import type { SharedAgentData } from '@lobechat/types';

/**
 * Whether the share still accepts visitor traffic.
 *
 * Every visitor-facing `shareChat` procedure runs through
 * `resolveLinkShareOrThrow`, which rejects anything but `link` visibility with
 * `FORBIDDEN`. An owner previewing their own private share therefore reaches
 * this page (via `assertShareAccess`) but must not fire those calls — chatting
 * and the topic list alike would only render a useless error.
 */
export const isShareInteractive = (visibility: SharedAgentData['visibility']): boolean =>
  visibility === 'link';
