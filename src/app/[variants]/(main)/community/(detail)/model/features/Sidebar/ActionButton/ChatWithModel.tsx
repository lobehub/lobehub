'use client';

import { ProviderIcon } from '@lobehub/icons';
import { Button, Icon } from '@lobehub/ui';
import { Dropdown } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    button {
      width: 100%;
    }
  `,
}));

const ChatWithModel = memo(() => {
  const { t } = useTranslation('discover');
  const { providers = [] } = useDetailContext();
  const includeLobeHub = providers.some((item) => item.id === 'lobehub');
  const navigate = useNavigate();
  const list = providers.filter((provider) => provider.id !== 'lobehub');

  const items = list.map((item) => ({
    icon: <ProviderIcon provider={item.id} size={20} type={'avatar'} />,
    key: item.id,
    label: (
      <Link to={urlJoin('/community/provider', item.id)}>
        {[item.name, t('models.guide')].join(' ')}
      </Link>
    ),
  }));

  const handleLobeHubChat = () => {
    navigate('/agent');
  };

  if (includeLobeHub)
    return (
      <Dropdown.Button
        className={styles.button}
        icon={<Icon icon={ChevronDownIcon} />}
        menu={{
          items,
        }}
        onClick={handleLobeHubChat}
        overlayStyle={{ minWidth: 267 }}
        size={'large'}
        style={{ flex: 1, width: 'unset' }}
        type={'primary'}
      >
        {t('models.chat')}
      </Dropdown.Button>
    );

  if (items.length === 1)
    return (
      <Link style={{ flex: 1 }} to={urlJoin('/community/provider', items[0].key)}>
        <Button block className={styles.button} size={'large'} type={'primary'}>
          {t('models.guide')}
        </Button>
      </Link>
    );

  return (
    <Dropdown
      menu={{
        items,
      }}
      trigger={['click']}
    >
      <Button
        className={styles.button}
        size={'large'}
        style={{ flex: 1, width: 'unset' }}
        type={'primary'}
      >
        {t('models.guide')}
      </Button>
    </Dropdown>
  );
});

export default ChatWithModel;
