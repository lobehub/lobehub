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
      horizontal
      align={'center'}
      gap={8}
      onClick={() => {
        onConfigChange({ showFilesInKnowledgeBase: !config.showFilesInKnowledgeBase });
      }}
    >
      {t('FileManager.config.showFilesInLibrary')}
      <Switch size={'small'} value={config.showFilesInKnowledgeBase} />
    </Flexbox>
  );
});

export default Config;
