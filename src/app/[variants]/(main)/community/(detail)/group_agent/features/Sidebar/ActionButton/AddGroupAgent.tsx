'use client';

import { Button, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailData } from '../../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  buttonGroup: css`
    width: 100%;
  `,
  menuButton: css`
    padding-inline: 8px;
    border-start-start-radius: 0 !important;
    border-end-start-radius: 0 !important;
  `,
  primaryButton: css`
    border-start-end-radius: 0 !important;
    border-end-end-radius: 0 !important;
  `,
}));

const AddGroupAgent = memo<{ mobile?: boolean }>(({ mobile }) => {
  const data = useDetailData();
  const [isLoading, setIsLoading] = useState(false);
  const { message } = App.useApp();
  const { t } = useTranslation('discover');

  const { group } = data;

  const handleAddAndConverse = async () => {
    setIsLoading(true);
    try {
      // TODO: Implement add group agent logic
      // Decision needed:
      // - Option A: Full import (create local group + all member agents)
      // - Option B: Reference mode (save identifier, load dynamically)
      // - Option C: User choice (modal with options)

      message.info(
        t('groupAgents.addNotImplemented', {
          defaultValue: 'Add Group Agent feature is coming soon!',
        }),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = async () => {
    setIsLoading(true);
    try {
      // TODO: Same as above, but without navigation
      message.info(
        t('groupAgents.addNotImplemented', {
          defaultValue: 'Add Group Agent feature is coming soon!',
        }),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const menuItems = [
    {
      key: 'addGroup',
      label: t('groupAgents.addGroup', { defaultValue: 'Add Group' }),
      onClick: handleAdd,
    },
  ];

  return (
    <Flexbox className={styles.buttonGroup} gap={0} horizontal>
      <Button
        block
        className={styles.primaryButton}
        loading={isLoading}
        onClick={handleAddAndConverse}
        size={'large'}
        style={{ flex: 1, width: 'unset' }}
        type={'primary'}
      >
        {t('groupAgents.addAndConverse', { defaultValue: 'Add & Start Conversation' })}
      </Button>
      <DropdownMenu
        items={menuItems}
        popupProps={{ style: { minWidth: 267 } }}
        triggerProps={{ disabled: isLoading }}
      >
        <Button
          className={styles.menuButton}
          disabled={isLoading}
          icon={<Icon icon={ChevronDownIcon} />}
          size={'large'}
          type={'primary'}
        />
      </DropdownMenu>
    </Flexbox>
  );
});

export default AddGroupAgent;
