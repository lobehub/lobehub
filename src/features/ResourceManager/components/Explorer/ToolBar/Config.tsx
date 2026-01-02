import { Flexbox } from '@lobehub/ui';
import { Switch } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ConfigProps {
  config: { showFilesInKnowledgeBase: boolean };
  onConfigChange: (config: { showFilesInKnowledgeBase: boolean }) => void;
}

const Config = memo<ConfigProps>(({ config, onConfigChange }) => {
  const { t } = useTranslation('components');

  return (
    <Flexbox
      align={'center'}
      gap={8}
      horizontal
      onClick={() => {
        onConfigChange({ showFilesInKnowledgeBase: !config.showFilesInKnowledgeBase });
      }}
    >
      {t('FileManager.config.showFilesInKnowledgeBase')}
      <Switch size={'small'} value={config.showFilesInKnowledgeBase} />
    </Flexbox>
  );
});

export default Config;
