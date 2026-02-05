'use client';

import { Button, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { SESSION_CHAT_URL } from '@/const/url';
import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';

import { useDetailContext } from '../../DetailProvider';

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

const AddAgent = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { avatar, description, tags, title, config, backgroundColor, identifier, editorData } =
    useDetailContext();
  const [isLoading, setIsLoading] = useState(false);
  const createAgent = useAgentStore((s) => s.createAgent);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const { t } = useTranslation('discover');

  const meta = {
    avatar,
    backgroundColor,
    description,
    marketIdentifier: identifier,
    tags,
    title,
  };

  const checkDuplicateAgent = async () => {
    if (!identifier) return false;
    return agentService.checkByMarketIdentifier(identifier);
  };

  const showDuplicateConfirmation = (callback: () => void) => {
    modal.confirm({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('assistants.duplicateAdd.content', { title }),
      okText: t('assistants.duplicateAdd.ok'),
      onOk: callback,
      title: t('assistants.duplicateAdd.title'),
    });
  };

  const createAgentWithMarketIdentifier = async (shouldNavigate = true) => {
    if (!config) return;

    // Note: agentService.createAgent automatically normalizes market config (handles model as object)
    const agentData = {
      config: {
        ...config,
        editorData,
        ...meta,
      },
    };

    const result = await createAgent(agentData);
    await refreshAgentList();

    // Report agent installation to marketplace if it has a market identifier
    if (identifier) {
      discoverService.reportAgentInstall(identifier);
      discoverService.reportAgentEvent({
        event: 'add',
        identifier,
        source: location.pathname,
      });
    }

    void shouldNavigate;

    return result;
  };

  const handleCreateAndConverse = async () => {
    setIsLoading(true);
    try {
      const result = await createAgentWithMarketIdentifier(true);
      message.success(t('assistants.addAgentSuccess'));
      navigate(SESSION_CHAT_URL(result!.agentId || result!.sessionId, mobile));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    setIsLoading(true);
    try {
      await createAgentWithMarketIdentifier(false);
      message.success(t('assistants.addAgentSuccess'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAgentAndConverse = async () => {
    if (!config) return;

    const isDuplicate = await checkDuplicateAgent();
    if (isDuplicate) {
      showDuplicateConfirmation(handleCreateAndConverse);
    } else {
      await handleCreateAndConverse();
    }
  };

  const handleAddAgent = async () => {
    if (!config) return;

    const isDuplicate = await checkDuplicateAgent();
    if (isDuplicate) {
      showDuplicateConfirmation(handleCreate);
    } else {
      await handleCreate();
    }
  };

  const menuItems = [
    {
      key: 'addAgent',
      label: t('assistants.addAgent'),
      onClick: handleAddAgent,
    },
  ];

  return (
    <Flexbox horizontal className={styles.buttonGroup} gap={0}>
      <Button
        block
        className={styles.primaryButton}
        loading={isLoading}
        size={'large'}
        style={{ flex: 1, width: 'unset' }}
        type={'primary'}
        onClick={handleAddAgentAndConverse}
      >
        {t('assistants.addAgentAndConverse')}
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

export default AddAgent;
