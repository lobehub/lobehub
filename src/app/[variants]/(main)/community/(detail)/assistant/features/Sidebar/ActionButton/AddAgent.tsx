'use client';

import { Icon } from '@lobehub/ui';
import { App, Dropdown } from 'antd';
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
  button: css`
    button {
      width: 100%;
    }
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
    }

    if (shouldNavigate) {
      console.log(shouldNavigate);
    }
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

  return (
    <Dropdown.Button
      className={styles.button}
      icon={<Icon icon={ChevronDownIcon} />}
      loading={isLoading}
      menu={{
        items: [
          {
            key: 'addAgent',
            label: t('assistants.addAgent'),
            onClick: handleAddAgent,
          },
        ],
      }}
      onClick={handleAddAgentAndConverse}
      overlayStyle={{ minWidth: 267 }}
      size={'large'}
      style={{ flex: 1, width: 'unset' }}
      type={'primary'}
    >
      {t('assistants.addAgentAndConverse')}
    </Dropdown.Button>
  );
});

export default AddAgent;
