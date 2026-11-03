'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GenerationMediaModeSegment from '@/routes/(main)/(create)/features/GenerationInput/GenerationMediaModeSegment';

interface PromptTitleProps {
  mode: 'image' | 'video';
}

const PromptTitle = memo<PromptTitleProps>(({ mode }) => {
  const { t } = useTranslation('common');

  return (
    <Flexbox
      horizontal
      align={'center'}
      justify={'center'}
      style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 24 }}
      width={'100%'}
    >
      {t('generation.hero.taglinePrefix')}
      <GenerationMediaModeSegment layout={'hero'} mode={mode} />
    </Flexbox>
  );
});

PromptTitle.displayName = 'PromptTitle';

export default PromptTitle;
