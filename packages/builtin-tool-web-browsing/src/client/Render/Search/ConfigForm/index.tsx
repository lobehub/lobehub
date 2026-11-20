import { Center, Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import SearchXNGIcon from './SearchXNGIcon';
import { FormAction } from './style';

interface ConfigAlertProps {
  id: string;
  provider: string;
}

const ConfigAlert = memo<ConfigAlertProps>(({ provider, id }) => {
  const { t } = useTranslation('plugin');

  const deleteMessage = useChatStore((s) => s.deleteMessage);

  const avatar = useMemo(() => {
    switch (provider) {
      default: {
        return <SearchXNGIcon />;
      }
    }
  }, [provider]);

  return (
    <Center gap={16} style={{ width: 400 }}>
      <FormAction
        avatar={avatar}
        description={t('search.searchxng.unconfiguredDesc')}
        title={t('search.searchxng.unconfiguredTitle')}
      >
        <Flexbox gap={12} width={'100%'}>
          <Button
            block
            onClick={() => {
              deleteMessage(id);
            }}
          >
            {t('search.config.close')}
          </Button>
        </Flexbox>
      </FormAction>
    </Center>
  );
});

export default ConfigAlert;
