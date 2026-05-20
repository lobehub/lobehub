'use client';

import { Button } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { customAlphabet } from 'nanoid/non-secure';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { SESSION_CHAT_URL } from '@/const/url';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { marketApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';

import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  buttonGroup: css`
    width: 100%;
  `,
}));

const generateMarketIdentifier = () => {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const generate = customAlphabet(alphabet, 8);
  return generate();
};

const ForkAndChat = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { identifier, title, config, avatar, backgroundColor, description, tags, editorData } =
    useDetailContext();
  const [isLoading, setIsLoading] = useState(false);
  const createAgent = useAgentStore((s) => s.createAgent);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { t } = useTranslation('discover');
  const { isAuthenticated, signIn } = useMarketAuth();

  const meta = {
    avatar,
    backgroundColor,
    description,
    marketIdentifier: identifier,
    tags,
    title,
  };

  const handleForkAndChat = async () => {
    if (!isAuthenticated) {
      try {
        await signIn();
      } catch {
        return;
      }
    }

    setIsLoading(true);

    try {
      // Step 1: Check if user already forked this agent
      if (identifier) {
        const existingAgentId = await agentService
          .getAgentByForkedFromIdentifier(identifier)
          .catch(() => null);

        if (existingAgentId) {
          message.info(t('fork.alreadyForked'));
          navigate(SESSION_CHAT_URL(existingAgentId, mobile));
          return;
        }
      }

      if (!config) throw new Error('Agent config is missing');

      const newIdentifier = generateMarketIdentifier();

      // Step 2: Attempt market API fork (non-fatal if it fails)
      let marketIdentifier = newIdentifier;
      try {
        if (identifier) {
          const [forkOutcome] = await marketApiService.forkAgent([
            {
              identifier: newIdentifier,
              name: title,
              sourceIdentifier: identifier,
              status: 'published',
              visibility: 'public',
            },
          ]);
          if (forkOutcome.success && forkOutcome.data?.agent?.identifier) {
            marketIdentifier = forkOutcome.data.agent.identifier;
          }
        }
      } catch {
        // Market fork failed — continue with local-only agent creation
      }

      // Step 3: Create local agent with forked config
      const agentData = {
        config: {
          ...config,
          editorData,
          ...meta,
          marketIdentifier,
          params: {
            ...config.params,
            forkedFromIdentifier: identifier,
          },
          title: title || config.title,
        },
      };

      const result = await createAgent(agentData);
      await refreshAgentList();

      // Step 4: Report event (non-fatal)
      if (identifier) {
        discoverService
          .reportAgentEvent({
            event: 'add',
            identifier: marketIdentifier,
            source: location.pathname,
          })
          .catch(() => null);
      }

      message.success(t('fork.success'));
      navigate(SESSION_CHAT_URL(result!.agentId, mobile));
    } catch (error: any) {
      console.error('[ForkAndChat] Fork failed:', error);
      message.error(t('fork.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      block
      className={styles.buttonGroup}
      loading={isLoading}
      size={'large'}
      type={'primary'}
      onClick={handleForkAndChat}
    >
      {t('fork.forkAndChat')}
    </Button>
  );
});

export default ForkAndChat;
