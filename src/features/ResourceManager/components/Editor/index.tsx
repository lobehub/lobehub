'use client';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Modal } from 'antd';
import { cssVar, useTheme } from 'antd-style';
import { ArrowLeftIcon, DownloadIcon, InfoIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileDetailComponent from '@/app/[variants]/(main)/resource/features/FileDetail';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import PageAgentProvider from '@/features/PageEditor/PageAgentProvider';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { downloadFile } from '@/utils/client/downloadFile';

import FileContent from './FileContent';

interface FileEditorProps {
  onBack?: () => void;
}

const FileEditorCanvas = memo<FileEditorProps>(({ onBack }) => {
  const { t } = useTranslation(['common', 'file']);
  const theme = useTheme();
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const currentViewItemId = useResourceManagerStore((s) => s.currentViewItemId);

  const fileDetail = useFileStore(fileManagerSelectors.getFileById(currentViewItemId));

  return (
    <>
      <Flexbox horizontal height={'100%'} width={'100%'}>
        <Flexbox flex={1} height={'100%'}>
          <NavHeader
            left={
              <Flexbox horizontal align={'center'} gap={12} style={{ minHeight: 32, minWidth: 0, overflow: 'hidden' }}>
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
                {/* <ToggleRightPanelButton icon={BotMessageSquareIcon} showActive={true} size={20} /> */}
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
                <ActionIcon icon={InfoIcon} onClick={() => setIsDetailModalOpen(true)} />
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
        {/* <FileCopilot /> */}
      </Flexbox>

      <Modal
        footer={null}
        open={isDetailModalOpen}
        title={t('detail.basic.title', { ns: 'file' })}
        width={400}
        onCancel={() => setIsDetailModalOpen(false)}
      >
        {fileDetail && (
          <FileDetailComponent {...fileDetail} showDownloadButton={false} showTitle={false} />
        )}
      </Modal>
    </>
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
  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  const pageAgentId = useAgentStore(builtinAgentSelectors.pageAgentId);

  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.pageAgent);

  if (!pageAgentId) return <Loading debugId="FileEditor > PageAgent Init" />;

  return (
    <PageAgentProvider pageAgentId={pageAgentId}>
      <FileEditorCanvas onBack={onBack} />
    </PageAgentProvider>
  );
});

FileEditor.displayName = 'FileEditor';

export default FileEditor;
