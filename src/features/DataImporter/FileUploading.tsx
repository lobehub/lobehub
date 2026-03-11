import { Flexbox } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSpeed, formatTime } from '@/utils/format';

import DataLoading from './Loading';

interface FileUploadingProps {
  progress?: number;
  restTime?: number;
  speed?: number;
}

export const FileUploading = memo<FileUploadingProps>(({ progress = 0, speed = 0, restTime }) => {
  const { t } = useTranslation('common');

  return (
    <>
      <DataLoading />
      <Flexbox align={'center'} gap={8} width={'100%'}>
        {t('importModal.uploading.desc')}
        <Flexbox flex={1} gap={8} width={'100%'}>
          <Progress
            showInfo
            percent={progress}
            strokeColor={cssVar.colorSuccess}
            trailColor={cssVar.colorSuccessBg}
          />
          <Flexbox
            horizontal
            distribution={'space-between'}
            style={{ color: cssVar.colorTextDescription, fontSize: 12 }}
          >
            <span>
              {t('importModal.uploading.restTime')}: {restTime ? formatTime(restTime) : '-'}
            </span>
            <span>
              {t('importModal.uploading.speed')}: {formatSpeed(speed * 1024)}
            </span>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </>
  );
});
