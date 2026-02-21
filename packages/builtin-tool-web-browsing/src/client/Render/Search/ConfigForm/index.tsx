import { Button, Center, Flexbox } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';
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

  const [resend, deleteMessage] = useChatStore((s) => [s.reInvokeToolMessage, s.deleteMessage]);

  const [loading, setLoading] = useState(false);

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
            disabled={loading}
            style={{ marginTop: 8 }}
            type={'primary'}
            onClick={async () => {
              setLoading(true);
              resend(id).then(() => {
                setLoading(false);
              });
              // deleteMessage(id);
            }}
          >
            {t('search.config.confirm')}
          </Button>
          <Button
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
