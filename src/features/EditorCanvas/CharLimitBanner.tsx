'use client';

import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessDocumentCharLimit } from '@/business/client/hooks/useBusinessDocumentCharLimit';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { resolveCharLimitNotice } from './charLimitNotice';

export interface CharLimitBannerProps {
  documentId?: string;
  /**
   * Keeps the refused-save notice pinned to the top of the scrolling body, so
   * it stays visible when the banner sits inside the scroll host. A host that
   * renders the banner above its scroll area leaves this off.
   */
  sticky?: boolean;
}

/**
 * Persistent notice for the plan's per-page character limit:
 *
 * - blocked: the last save was refused and the page is still over the limit.
 *   The edits are not saved, so this stays until the page is shortened (the next
 *   successful save clears the stored refusal).
 * - near: the page reached 90% of the known limit. The limit comes from the last
 *   refusal, else from the business hook (Cloud: the current personal plan).
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

  const notice = resolveCharLimitNotice({ length, planLimit, refusal });
  if (!notice) return null;

  const format = new Intl.NumberFormat(i18n.language);
  const values = { actual: format.format(length), limit: format.format(notice.limit) };

  if (notice.kind === 'blocked') {
    return (
      <Alert
        showIcon
        action={action}
        description={t('pageEditor.charLimit.blockedDescription')}
        title={t('pageEditor.charLimit.blockedTitle', values)}
        type="warning"
        style={
          sticky
            ? { insetBlockStart: 0, marginBlock: 8, position: 'sticky', zIndex: 2 }
            : { marginBlock: 8 }
        }
      />
    );
  }

  return (
    <Alert
      showIcon
      action={action}
      description={t('pageEditor.charLimit.nearDescription')}
      style={{ marginBlock: 8 }}
      title={t('pageEditor.charLimit.nearTitle', values)}
      type="info"
    />
  );
});

CharLimitBanner.displayName = 'CharLimitBanner';

export default CharLimitBanner;
