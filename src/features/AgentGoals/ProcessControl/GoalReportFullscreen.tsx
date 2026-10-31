'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import {
  ActionIcon,
  copyToClipboard,
  Drawer,
  DropdownMenu,
  Flexbox,
  HtmlPreview,
  Icon,
  Text,
  toast,
} from '@lobehub/ui';
import { Download, Link2, MoreHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import HtmlPageShareButton from '@/business/client/features/HtmlPageShareButton';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { isDesktop } from '@/const/version';
import { buildDocumentModalUrl } from '@/features/DocumentModal/url';
import { useHtmlExport } from '@/features/Portal/Document/useHtmlExport';
import { useAppOrigin } from '@/hooks/useAppOrigin';

const hideHtmlPreviewActions = () => null;

interface GoalReportFullscreenProps {
  content: string;
  documentId: string;
  onClose: () => void;
  open: boolean;
  title: string;
}

/**
 * The report page full screen, to read it whole. Link and download sit in the
 * menu beside the title; sharing it as a public page is the header's action.
 */
const GoalReportFullscreen = memo<GoalReportFullscreenProps>(
  ({ content, documentId, onClose, open, title }) => {
    const { t } = useTranslation(['file', 'common', 'components']);
    const appOrigin = useAppOrigin();
    const workspaceSlug = useActiveWorkspaceSlug();
    const exportHtml = useHtmlExport(documentId);

    const menu = [
      {
        icon: <Icon icon={Link2} />,
        key: 'copy-link',
        label: t('pageEditor.menu.copyLink'),
        onClick: async () => {
          await copyToClipboard(buildDocumentModalUrl(appOrigin, documentId, workspaceSlug));
          toast.success(t('pageEditor.linkCopied'));
        },
      },
      {
        disabled: !exportHtml,
        icon: <Icon icon={Download} />,
        key: 'download',
        label: t('HtmlPreview.actions.download', { ns: 'components' }),
        onClick: () => exportHtml?.(),
      },
    ];

    return (
      <Drawer
        containerMaxWidth={'100%'}
        extra={<HtmlPageShareButton documentId={documentId} html={content} title={title} />}
        height={isDesktop ? `calc(100vh - ${TITLE_BAR_HEIGHT}px)` : '100vh'}
        open={open}
        placement={'bottom'}
        styles={{
          bodyContent: { height: '100%', padding: 0 },
          header: { paddingBlock: 8, paddingInline: 12 },
        }}
        title={
          <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
            <Text ellipsis weight={500}>
              {title}
            </Text>
            <DropdownMenu items={menu}>
              <ActionIcon
                icon={MoreHorizontal}
                size={'small'}
                title={t('more', { ns: 'common' })}
              />
            </DropdownMenu>
          </Flexbox>
        }
        onClose={onClose}
      >
        <HtmlPreview
          actionsRender={hideHtmlPreviewActions}
          copyable={false}
          downloadable={false}
          style={{ height: '100%' }}
          styles={{ iframe: { height: '100%' } }}
          title={title}
          variant={'borderless'}
        >
          {content}
        </HtmlPreview>
      </Drawer>
    );
  },
);

GoalReportFullscreen.displayName = 'GoalReportFullscreen';

export default GoalReportFullscreen;
