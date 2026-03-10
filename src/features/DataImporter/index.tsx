'use client';

import { type ErrorShape, type ImportFileUploadState } from '@lobechat/types';
import { ImportStage } from '@lobechat/types';
import { Center } from '@lobehub/ui';
import { Upload } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { ImportIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import React, { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DataStyleModal from '@/components/DataStyleModal';
import { importService } from '@/services/import';
import { useChatStore } from '@/store/chat';
import { useHomeStore } from '@/store/home';
import { type ImportPgDataStructure } from '@/types/export';

import { parseConfigFile } from './config';
import ImportError from './Error';
import { FileUploading } from './FileUploading';
import ImportPreviewModal from './ImportDetail';
import DataLoading from './Loading';
import SuccessResult from './SuccessResult';

export interface ImportResult {
  added: number;
  errors: number;
  skips: number;
  updated?: number;
}
export interface ImportResults {
  messages?: ImportResult;
  sessionGroups?: ImportResult;
  sessions?: ImportResult;
  topics?: ImportResult;
  type?: string;
}

const styles = createStaticStyles(({ css }) => ({
  children: css`
    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background-color: transparent;
    }
  `,
  wrapper: css`
    font-size: inherit;
  `,
}));

interface DataImporterProps {
  children?: ReactNode;
  onFinishImport?: () => void;
}

const DataImporter = memo<DataImporterProps>(({ children, onFinishImport }) => {
  const { t } = useTranslation('common');

  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const [refreshMessages, refreshTopics] = useChatStore((s) => [s.refreshMessages, s.refreshTopic]);

  const [duration, setDuration] = useState(0);
  const [importState, setImportState] = useState(ImportStage.Start);

  const [fileUploadingState, setUploadingState] = useState<ImportFileUploadState | undefined>();
  const [importError, setImportError] = useState<ErrorShape | undefined>();
  const [importResults, setImportResults] = useState<ImportResults | undefined>();
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPgData, setImportPgData] = useState<ImportPgDataStructure | undefined>(undefined);

  const dataSource = useMemo(() => {
    if (!importResults) return;

    const { type, ...res } = importResults;

    if (type === 'settings') return;

    return Object.entries(res)
      .filter(([, v]) => !!v)
      .map(([item, value]: [string, ImportResult]) => ({
        added: value.added,
        error: value.errors,
        skips: value.skips,
        title: item,
        updated: value.updated || 0,
      }));
  }, [importResults]);

  const isFinished = importState === ImportStage.Success || importState === ImportStage.Error;

  const closeModal = () => {
    setImportState(ImportStage.Finished);
    setImportResults(undefined);
    setImportError(undefined);
    setUploadingState(undefined);

    onFinishImport?.();
  };

  const content = useMemo(() => {
    switch (importState) {
      case ImportStage.Preparing: {
        return (
          <Center gap={24} padding={40}>
            <DataLoading />
            <p>{t('importModal.preparing')}</p>
          </Center>
        );
      }

      case ImportStage.Importing: {
        return (
          <Center gap={24} padding={40}>
            <DataLoading />
            <p>{t('importModal.loading')}</p>
          </Center>
        );
      }

      case ImportStage.Uploading: {
        return (
          <Center gap={24} padding={40}>
            <FileUploading
              progress={fileUploadingState?.progress}
              restTime={fileUploadingState?.restTime}
              speed={fileUploadingState?.speed}
            />
          </Center>
        );
      }

      case ImportStage.Success: {
        return (
          <Center gap={24} paddingInline={16}>
            <SuccessResult dataSource={dataSource} duration={duration} onClickFinish={closeModal} />
          </Center>
        );
      }
      case ImportStage.Error: {
        return (
          <Center gap={24} paddingBlock={24} paddingInline={0}>
            <ImportError error={importError} onClick={closeModal} />
          </Center>
        );
      }

      default: {
        return undefined;
      }
    }
  }, [importState, fileUploadingState]);

  return (
    <>
      <DataStyleModal
        icon={ImportIcon}
        open={importState !== ImportStage.Start && importState !== ImportStage.Finished}
        title={t('importModal.title')}
        width={isFinished ? 600 : 400}
      >
        {content}
      </DataStyleModal>
      <Upload
        accept={'application/json'}
        className={cx(styles.wrapper)}
        maxCount={1}
        showUploadList={false}
        beforeUpload={async (file) => {
          const config = await parseConfigFile(file);
          if (!config) return false;

          setImportPgData(config);
          setShowImportModal(true);

          return false;
        }}
      >
        {/* a very hackable solution: add a pseudo before to have a large hot zone */}
        <div className={cx(styles.children)}>{children}</div>
      </Upload>
      {importPgData && (
        <ImportPreviewModal
          importData={importPgData}
          open={showImportModal}
          onOpenChange={setShowImportModal}
          onConfirm={async (overwriteExisting) => {
            setImportState(ImportStage.Preparing);

            await importService.importPgData(importPgData, {
              callbacks: {
                onError: (error) => {
                  setImportError(error);
                },
                onFileUploading: (state) => {
                  setUploadingState(state);
                },
                onStageChange: (stage) => {
                  setImportState(stage);
                },
                onSuccess: (data, duration) => {
                  if (data) setImportResults(data);
                  setDuration(duration);
                },
              },
              overwriteExisting,
            });

            await refreshAgentList();
            await refreshMessages();
            await refreshTopics();
          }}
        />
      )}
    </>
  );
});

export default DataImporter;
