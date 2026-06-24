'use client';

import { ProviderIcon } from '@lobehub/icons';
import { Button, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    button {
      width: 100%;
    }
  `,
  // Joined split-button: main action + dropdown chevron, sharing a border like
  // antd's Dropdown.Button. Both <button>s are direct children because
  // DropdownMenu renders its trigger inline (Menu.Root is context-only).
  splitButton: css`
    & > button + button {
      margin-inline-start: -1px;
    }

    & > button:first-child {
      border-start-end-radius: 0;
      border-end-end-radius: 0;
    }

    & > button:last-child {
      border-start-start-radius: 0;
      border-end-start-radius: 0;
    }
  `,
}));

const ChatWithModel = memo(() => {
  const { t } = useTranslation('discover');
  const { providers = [] } = useDetailContext();
  const includeLobeHub = providers.some((item) => item.id === 'lobehub');
  const navigate = useWorkspaceAwareNavigate();
  const list = providers.filter((provider) => provider.id !== 'lobehub');

  const items = list.map((item) => ({
    icon: <ProviderIcon provider={item.id} size={20} type={'avatar'} />,
    key: item.id,
    label: (
      <WorkspaceLink to={urlJoin('/community/provider', item.id)}>
        {[item.name, t('models.guide')].join(' ')}
      </WorkspaceLink>
    ),
  }));

  const handleLobeHubChat = () => {
    navigate('/agent');
  };

  if (includeLobeHub)
    return (
      <Flexbox horizontal className={styles.splitButton} style={{ flex: 1, width: 'unset' }}>
        <Button size={'large'} style={{ flex: 1 }} type={'primary'} onClick={handleLobeHubChat}>
          {t('models.chat')}
        </Button>
        <DropdownMenu items={items} popupProps={{ style: { minWidth: 267 } }}>
          <Button icon={<Icon icon={ChevronDownIcon} />} size={'large'} type={'primary'} />
        </DropdownMenu>
      </Flexbox>
    );

  if (items.length === 1)
    return (
      <WorkspaceLink style={{ flex: 1 }} to={urlJoin('/community/provider', items[0].key)}>
        <Button block className={styles.button} size={'large'} type={'primary'}>
          {t('models.guide')}
        </Button>
      </WorkspaceLink>
    );

  return (
    <DropdownMenu data-no-highlight items={items}>
      <Button
        className={styles.button}
        size={'large'}
        style={{ flex: 1, width: 'unset' }}
        type={'primary'}
      >
        {t('models.guide')}
      </Button>
    </DropdownMenu>
  );
});

export default ChatWithModel;
