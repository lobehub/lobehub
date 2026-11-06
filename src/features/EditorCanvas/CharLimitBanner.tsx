'use client';

import { type CSSProperties, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessDocumentCharLimit } from '@/business/client/hooks/useBusinessDocumentCharLimit';
import { NoticeAlert } from '@/components/NoticeAlert';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { type CharLimitNotice, resolveCharLimitNotice } from './charLimitNotice';

export interface CharLimitBannerProps {
  documentId?: string;
  /**
   * Keeps the over-limit notices pinned to the top of the scrolling body, so
   * they stay visible when the banner sits inside the scroll host. A host that
   * renders the banner above its scroll area leaves this off.
   */
  sticky?: boolean;
}

/** Severity climbs with the page: a heads-up, then a warning, then lost edits. */
const ALERT_TYPE = { blocked: 'error', near: 'info', over: 'warning' } as const;

const BANNER_STYLE: CSSProperties = { marginBlock: 8 };
const STICKY_BANNER_STYLE: CSSProperties = {
  ...BANNER_STYLE,
  insetBlockStart: 0,
  position: 'sticky',
  zIndex: 2,
};

const TITLE_KEY = {
  blocked: 'pageEditor.charLimit.blockedTitle',
  near: 'pageEditor.charLimit.nearTitle',
  over: 'pageEditor.charLimit.blockedTitle',
} as const satisfies Record<CharLimitNotice['kind'], string>;

const DESCRIPTION_KEY = {
  blocked: 'pageEditor.charLimit.blockedDescription',
  near: 'pageEditor.charLimit.nearDescription',
  over: 'pageEditor.charLimit.overDescription',
} as const satisfies Record<CharLimitNotice['kind'], string>;

/**
 * Persistent notice for the plan's per-page character limit. The limit comes
 * from the last refusal, else from the business hook (Cloud: the current
 * personal plan).
 *
 * - near: the page reached 90% of the limit. A heads-up the user can dismiss.
 * - over: the page is past the limit and the next save will be refused.
 * - blocked: the last save was refused and the page is still over the limit.
 *   The edits are not saved, so this stays until the page is shortened (the next
 *   successful save clears the stored refusal).
 *
 * Only `over` and `blocked` can be pinned: a dismissible heads-up has no
 * business following the user down the page.
 */
const CharLimitBanner = memo<CharLimitBannerProps>(({ documentId, sticky }) => {
  const { t, i18n } = useTranslation('file');
  const refusal = useDocumentStore((s) =>
    documentId ? editorSelectors.charLimitError(documentId)(s) : undefined,
  );
  const length = useDocumentStore((s) =>
    documentId ? editorSelectors.content(documentId)(s).length : 0,
  );
  const { action, limit: planLimit } = useBusinessDocumentCharLimit();
  // Dismissing the heads-up is per page and lasts for the session; going over
  // the limit shows the banner again regardless.
  const [dismissedNearFor, setDismissedNearFor] = useState<string>();

  const notice = resolveCharLimitNotice({ length, planLimit, refusal });
  if (!notice) return null;
  if (notice.kind === 'near' && dismissedNearFor === (documentId ?? '')) return null;

  const format = new Intl.NumberFormat(i18n.language);
  const values = { actual: format.format(length), limit: format.format(notice.limit) };

  return (
    // Keyed by kind, so a change of severity remounts instead of morphing.
    <NoticeAlert
      showIcon
      action={action}
      closable={notice.kind === 'near'}
      description={t(DESCRIPTION_KEY[notice.kind])}
      key={notice.kind}
      style={sticky && notice.kind !== 'near' ? STICKY_BANNER_STYLE : BANNER_STYLE}
      title={t(TITLE_KEY[notice.kind], values)}
      type={ALERT_TYPE[notice.kind]}
      onClose={() => setDismissedNearFor(documentId ?? '')}
    />
  );
});

CharLimitBanner.displayName = 'CharLimitBanner';

export default CharLimitBanner;
