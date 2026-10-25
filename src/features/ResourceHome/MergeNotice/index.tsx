'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next';
import { useEffect, useRef } from 'react';

import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/slices/recent/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import { DocsMergeNoticeContent } from './Content';
import { decideMergeNotice } from './decide';

const openDocsMergeNotice = (onClosed: () => void) =>
  createModal({
    content: <DocsMergeNoticeContent />,
    footer: null,
    maskClosable: true,
    // Any dismissal counts as read: the button, Esc, the backdrop or the ✕.
    onOpenChangeComplete: (open) => {
      if (!open) onClosed();
    },
    title: t('docs.mergeNotice.title', { ns: 'file' }),
    width: 'min(92vw, 480px)',
  });

/**
 * Tells a returning user, once, that Pages and Resources are now Docs. Mounted
 * in the Docs layout, so it greets them whether they open Docs directly or land
 * here through an old `/page` link. The acknowledgement is a user preference,
 * so it does not reappear on another device.
 */
export const useDocsMergeNotice = () => {
  const ready = useUserStore((s) => s.isUserStateInit);
  const hasConversation = useUserStore((s) => s.isUserHasConversation);
  const seen = useUserStore(preferenceSelectors.docsMergedNoticeSeen);
  const updateGuideState = useUserStore((s) => s.updateGuideState);
  const handled = useRef(false);

  // Only someone without a personal conversation needs the content check; it
  // reuses the Docs home list, so the home page reads it from the same cache.
  const checkContent = ready && !seen && !hasConversation;
  useHomeStore((s) => s.useFetchDocsHome)('recent', checkContent);
  const rows = useHomeStore(homeRecentSelectors.docsHome('recent'));

  const decision = decideMergeNotice({
    hasContent: rows === undefined ? undefined : rows.length > 0,
    hasConversation,
    ready,
    seen,
  });

  useEffect(() => {
    if (handled.current) return;
    const markSeen = () => void updateGuideState({ docsMerged: true });

    if (decision === 'show') {
      handled.current = true;
      openDocsMergeNotice(markSeen);
    } else if (decision === 'mark-seen') {
      handled.current = true;
      markSeen();
    }
  }, [decision, updateGuideState]);
};
