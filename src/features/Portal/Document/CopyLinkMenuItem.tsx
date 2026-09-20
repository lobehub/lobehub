'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { Link2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePortalDocumentHeaderActions } from './usePortalDocumentHeader';

/**
 * Copy-link action for the document portal header. Hidden entirely when the
 * viewer lacks the agent-documents binding that proves the active agent owns
 * the document (plain notebook documents have no agent route to link to).
 */
const CopyLinkMenuItem = memo(() => {
  const { t } = useTranslation(['chat', 'file', 'common']);
  const { agentDocumentId, copyLink } = usePortalDocumentHeaderActions();

  if (!agentDocumentId) return null;

  const label = t('pageEditor.menu.copyLink', { ns: 'file' });

  return <ActionIcon icon={Link2} size={'small'} title={label} onClick={() => void copyLink()} />;
});

CopyLinkMenuItem.displayName = 'PortalDocumentCopyLink';

export default CopyLinkMenuItem;
