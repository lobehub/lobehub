'use client';

import { ActionIcon, Avatar, copyToClipboard, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { DropdownMenu, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MoreHorizontal, XIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import ShareButton from '@/business/client/features/PageShare/ShareButton';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { DESKTOP_HEADER_ICON_SIZE, DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { AutoSaveHint } from '@/features/EditorCanvas';
import { useMenu } from '@/features/PageEditor/Header/useMenu';
import { usePageAgentPanelControl } from '@/features/PageEditor/RightPanel/OverrideContext';
import { usePageEditorStore } from '@/features/PageEditor/store';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { buildDocumentModalUrl } from './url';

const HEADER_HEIGHT = 44;

const styles = createStaticStyles(({ css }) => ({
  shareButton: css`
    & button:not(:hover, :focus-visible) {
      background: transparent;
    }
  `,
}));

const DocumentModalHeader = memo(() => {
  const { t } = useTranslation(['file', 'common']);
  const { close } = useModalContext();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const appOrigin = useAppOrigin();

  const [documentId, emoji, title] = usePageEditorStore((s) => [s.documentId, s.emoji, s.title]);
  const isDocumentLoading = useDocumentStore(editorSelectors.isDocumentLoading(documentId));
  const { expand: showPageAgentPanel, toggle: togglePageAgentPanel } = usePageAgentPanelControl();
  const handleCopyLink = useCallback(async () => {
    if (!documentId) return;
    await copyToClipboard(buildDocumentModalUrl(appOrigin, documentId, activeWorkspaceSlug));
    toast.success(t('pageEditor.linkCopied'));
  }, [activeWorkspaceSlug, appOrigin, documentId, t]);
  const { menuItems } = useMenu({
    onCopyLink: handleCopyLink,
    onDeleted: close,
    onOpenHistory: () => togglePageAgentPanel(true),
  });

  return (
    <Flexbox
      horizontal
      align={'center'}
      flex={'none'}
      gap={4}
      height={HEADER_HEIGHT}
      justify={'space-between'}
      padding={8}
      style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
    >
      <Flexbox allowShrink horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
        {emoji && <Avatar avatar={emoji} shape={'square'} size={24} />}
        {isDocumentLoading && !title ? (
          <Skeleton.Button
            active
            size={'small'}
            style={{ height: 14, minWidth: 120, width: 120 }}
          />
        ) : (
          <Text ellipsis style={{ minWidth: 0 }} weight={500}>
            {title || t('pageEditor.titlePlaceholder')}
          </Text>
        )}
        {documentId && !isDocumentLoading && (
          <AutoSaveHint documentId={documentId} style={{ marginLeft: 4 }} />
        )}
        <DropdownMenu
          iconSpaceMode={'group'}
          items={menuItems}
          placement={'bottomLeft'}
          popupProps={{ style: { minWidth: 200 } }}
        >
          <ActionIcon icon={MoreHorizontal} size={DESKTOP_HEADER_ICON_SMALL_SIZE} />
        </DropdownMenu>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={4}>
        {documentId && (
          <span className={styles.shareButton}>
            <ShareButton documentId={documentId} />
          </span>
        )}
        <ToggleRightPanelButton
          expand={showPageAgentPanel}
          showActive={false}
          onToggle={() => togglePageAgentPanel()}
        />
        <ActionIcon
          icon={XIcon}
          size={DESKTOP_HEADER_ICON_SIZE}
          title={t('close', { ns: 'common' })}
          onClick={close}
        />
      </Flexbox>
    </Flexbox>
  );
});

DocumentModalHeader.displayName = 'DocumentModalHeader';

export default DocumentModalHeader;
