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

/**
 * View or Edit a file
 *
 * It's a un-reusable component for business logic only.
 * So we depend on context, not props.
 */
const FileEditor = memo(() => {
  const { t } = useTranslation('common');

  const [currentViewItemId, category, setMode, setCurrentViewItemId, libraryId] =
    useResourceManagerStore((s) => [
      s.currentViewItemId,
      s.category,
      s.setMode,
      s.setCurrentViewItemId,
      s.libraryId,
    ]);

  const fileDetail = useFileStore(fileManagerSelectors.getFileById(currentViewItemId));

  return (
    <Flexbox height={'100%'}>
      <NavHeader
        left={
          <Flexbox align={'center'} gap={4} horizontal style={{ minHeight: 32 }}>
            <ActionIcon
              icon={ArrowLeftIcon}
              onClick={() => {
                setMode('explorer');
                setCurrentViewItemId(undefined);
              }}
              size={'small'}
              title={t('back')}
            />
            <Flexbox align={'center'} style={{ marginLeft: 8 }}>
              <Breadcrumb
                category={category}
                fileName={fileDetail?.name}
                knowledgeBaseId={libraryId}
              />
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
