'use client';

import { cssVar, Flexbox } from '@lobehub/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import ProcessExplorer from '@/features/BackgroundActivity/ProcessExplorer';

import PopupTitleBar from '../_layout/TitleBar';

const ProcessExplorerPage = () => {
  const { t } = useTranslation('chat');
  const title = t('processExplorer.title');
  useEffect(() => {
    document.title = title;
  }, [title]);
  return (
    <Flexbox
      height={'100%'}
      style={{ background: cssVar.colorBgContainer, overflow: 'hidden' }}
      width={'100%'}
    >
      <PopupTitleBar title={title} />
      <ProcessExplorer />
    </Flexbox>
  );
};

export default ProcessExplorerPage;
