'use client';

import { inspectorTextStyles } from '@lobechat/shared-tool-ui/styles';
import { useTranslation } from 'react-i18next';

export const ImageOutputInspector = () => {
  const { t } = useTranslation('plugin');
  return (
    <span className={inspectorTextStyles.root}>{t('builtins.codex.apiName.image_output')}</span>
  );
};
