import type { UIChatMessage } from '@lobechat/types';
import { useEffect, useRef } from 'react';

import { findBranchSwitchesToMessage } from '../utils/deepLinkBranch';
import type { MessageDeepLink } from '../utils/messageDeepLink';

interface UseDeepLinkBranchActivationOptions {
  deepLink?: MessageDeepLink;
  /** The conversation's loaded rows, every branch included. */
  messages: UIChatMessage[];
  /** The target already renders on the displayed path. */
  resolved: boolean;
  switchMessageBranch: (messageId: string, branchIndex: number) => Promise<void>;
}

/**
 * When a deep-linked message is loaded but sits on a branch the user moved
 * away from, switch each fork on its path once per navigation so the
 * conversation renders it and the deep link can scroll there. Returns whether
 * the target row is loaded, which also tells history backfill to stop.
 */
export const useDeepLinkBranchActivation = ({
  deepLink,
  messages,
  resolved,
  switchMessageBranch,
}: UseDeepLinkBranchActivationOptions) => {
  const handledKeyRef = useRef<string | undefined>(undefined);
  const targetLoaded = !!deepLink && messages.some((message) => message.id === deepLink.id);

  useEffect(() => {
    if (!deepLink || resolved || !targetLoaded) return;
    if (handledKeyRef.current === deepLink.navigationKey) return;
    handledKeyRef.current = deepLink.navigationKey;

    const switches = findBranchSwitchesToMessage(messages, deepLink.id);
    void (async () => {
      for (const { branchIndex, messageId } of switches)
        await switchMessageBranch(messageId, branchIndex);
    })();
  }, [deepLink, messages, resolved, switchMessageBranch, targetLoaded]);

  return targetLoaded;
};
