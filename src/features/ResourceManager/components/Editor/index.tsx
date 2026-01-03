'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ArrowLeftIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import NavHeader from '@/features/NavHeader';
import { fileManagerSelectors, useFileStore } from '@/store/file';

import Breadcrumb from '../Explorer/Header/Breadcrumb';
import FileContent from './FileContent';

interface FileEditorProps {
  onBack?: () => void;
}

/**
 * View or Edit a file
 *
 * It's a un-reusable component for business logic only.
 * So we depend on context, not props.
 */
const FileEditor = memo<FileEditorProps>(({ onBack }) => {
  const { t } = useTranslation('common');

  const [currentViewItemId, category] = useResourceManagerStore((s) => [
    s.currentViewItemId,
    s.category,
  ]);

  const fileDetail = useFileStore(fileManagerSelectors.getFileById(currentViewItemId));

  return (
    <Flexbox height={'100%'}>
      <NavHeader
        left={
          <Flexbox align={'center'} gap={4} horizontal style={{ minHeight: 32 }}>
            <ActionIcon icon={ArrowLeftIcon} onClick={onBack} title={t('back')} />
            <Flexbox align={'center'} style={{ marginLeft: 8 }}>
              <Breadcrumb category={category} fileName={fileDetail?.name} />
            </Flexbox>
          </Flexbox>
        }
        style={{
          borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
        }}
        styles={{
          left: { padding: 0 },
        }}
      />
      <Flexbox flex={1} style={{ overflow: 'hidden' }}>
        <FileContent fileId={currentViewItemId} />
      </Flexbox>
    </Flexbox>
  );
});

export default FileEditor;
