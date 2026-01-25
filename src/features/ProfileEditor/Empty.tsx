import { Empty as EmptyComponent } from '@lobehub/ui';
import { BlocksIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const Empty = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <EmptyComponent
      description={t('tools.installed.empty', {
        defaultValue: 'No skills enabled',
      })}
      icon={BlocksIcon}
      style={{ paddingBlock: 40 }}
    />
  );
});

Empty.displayName = 'ToolEmpty';

export default Empty;
