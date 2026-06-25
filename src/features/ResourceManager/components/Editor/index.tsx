'use client';

import { ActionIcon, Flexbox, Skeleton } from '@lobehub/ui';
import { createModal } from '@lobehub/ui/base-ui';
import { cssVar, useTheme } from 'antd-style';
import { t as i18nT } from 'i18next';
import { ArrowLeftIcon, DownloadIcon, InfoIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import { PageAgentProvider } from '@/features/PageEditor/PageAgentProvider';
import { lambdaQuery } from '@/libs/trpc/client';
import FileDetailComponent from '@/routes/(main)/resource/features/FileDetail';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { downloadFile } from '@/utils/client/downloadFile';

import FileContent from './FileContent';

interface FileEditorProps {
  onBack?: () => void;
}

const FileDetailSkeleton = () => (
  <Flexbox gap={16}>
    <Skeleton
      active
      paragraph={{ rows: 5, width: ['80%', '60%', '40%', '70%', '70%'] }}
      title={false}
    />
    <Skeleton active paragraph={{ rows: 2, width: ['50%', '60%'] }} title={false} />
  </Flexbox>
);

const FileDetailModalContent = memo(() => {
  const currentViewItemId = useResourceManagerStore((s) => s.currentViewItemId);
  const fromStore = useFileStore(fileManagerSelectors.getFileById(currentViewItemId));
  const { data: fromQuery } = lambdaQuery.file.getFileItemById.useQuery(
    { id: currentViewItemId ?? '' },
    { enabled: !fromStore && !!currentViewItemId },
  );
  const fileDetail = fromStore ?? fromQuery;
  return (
    <Flexbox style={{ minHeight: 260 }}>
      {fileDetail ? (
        <FileDetailComponent {...fileDetail} showDownloadButton={false} showTitle={false} />
      ) : (
        <FileDetailSkeleton />
      )}
    </Flexbox>
  );
});

FileDetailModalContent.displayName = 'FileDetailModalContent';

const openFileDetailModal = () =>
  createModal({
    content: <FileDetailModalContent />,
    footer: null,
    maskClosable: true,
    title: i18nT('detail.basic.title', { ns: 'file' }),
    width: 400,
  });

const FileEditorCanvas = memo<FileEditorProps>(({ onBack }) => {
  const { t } = useTranslation(['common', 'file']);
  const theme = useTheme();

  const currentViewItemId = useResourceManagerStore((s) => s.currentViewItemId);

  const fileDetail = useFileStore(fileManagerSelectors.getFileById(currentViewItemId));

  return (
    <Flexbox horizontal height={'100%'} width={'100%'}>
      <Flexbox flex={1} height={'100%'}>
        <NavHeader
          left={
            <Flexbox
              horizontal
              align={'center'}
              gap={12}
              style={{ minHeight: 32, minWidth: 0, overflow: 'hidden' }}
            >
              <ActionIcon icon={ArrowLeftIcon} title={t('back')} onClick={onBack} />
              <span
                title={fileDetail?.name}
                style={{
                  color: theme.colorText,
                  fontSize: 14,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {fileDetail?.name}
              </span>
            </Flexbox>
          }
          right={
            <Flexbox horizontal gap={8}>
              {fileDetail?.url && (
                <ActionIcon
                  icon={DownloadIcon}
                  title={t('download', { ns: 'common' })}
                  onClick={() => {
                    if (fileDetail?.url && fileDetail?.name) {
                      downloadFile(fileDetail.url, fileDetail.name);
                    }
                  }}
                />
              )}
              <ActionIcon icon={InfoIcon} onClick={openFileDetailModal} />
            </Flexbox>
          }
          style={{
            borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
          }}
          styles={{
            left: { flex: 1, minWidth: 0, overflow: 'hidden', padding: 0 },
          }}
        />
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          <FileContent fileId={currentViewItemId} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

FileEditorCanvas.displayName = 'FileEditorCanvas';

/**
 * View or Edit a file
 *
 * It's a un-reusable component for business logic only.
 * So we depend on context, not props.
 */
const FileEditor = memo<FileEditorProps>(({ onBack }) => {
  return (
    <PageAgentProvider>
      <FileEditorCanvas onBack={onBack} />
    </PageAgentProvider>
  );
});

FileEditor.displayName = 'FileEditor';

export default FileEditor;
