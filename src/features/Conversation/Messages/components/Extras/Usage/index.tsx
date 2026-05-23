import {
  HETEROGENEOUS_TYPE_LABELS,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { type ModelPerformance, type ModelUsage } from '@lobechat/types';
import { ModelIcon } from '@lobehub/icons';
import { Center, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { isDev } from '@/utils/env';

import { contextSelectors, useConversationStore } from '../../../../store';
import TokenDetail from './UsageDetail';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface UsageProps {
  model: string;
  performance?: ModelPerformance;
  provider: string;
  usage?: ModelUsage;
}

const Usage = memo<UsageProps>(({ model, usage, performance, provider }) => {
  const onboardingAgentId = useAgentStore(builtinAgentSelectors.webOnboardingAgentId);
  const conversationAgentId = useConversationStore(contextSelectors.agentId);

  if (!isDev && onboardingAgentId && conversationAgentId === onboardingAgentId) return null;

  // Only remote platform agents (openclaw, hermes) replace the model name with
  // the brand label — they don't expose a real model id. Local CLI agents
  // (claude-code, codex) report their actual model on `turn_metadata` and
  // should keep showing it.
  const heteroName =
    provider && isRemoteHeterogeneousType(provider)
      ? HETEROGENEOUS_TYPE_LABELS[provider]
      : undefined;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.container}
      gap={12}
      justify={'space-between'}
    >
      <Center horizontal gap={4} style={{ fontSize: 12 }}>
        {heteroName ? (
          heteroName
        ) : (
          <>
            <ModelIcon model={model as string} type={'mono'} />
            {model}
          </>
        )}
      </Center>

      {!!usage?.totalTokens && (
        <TokenDetail
          model={model as string}
          performance={performance}
          provider={provider}
          usage={usage}
        />
      )}
    </Flexbox>
  );
}, isEqual);

export default Usage;
