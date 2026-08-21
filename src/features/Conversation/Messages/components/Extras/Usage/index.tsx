import {
  HETEROGENEOUS_TYPE_LABELS,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import type { ModelPerformance, ModelUsage } from '@lobechat/types';
import { unwrapServerDefaultHeterogeneousModel } from '@lobechat/types';
import { ModelIcon } from '@lobehub/icons';
import { Center, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { CircleDollarSignIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isDev } from '@/utils/env';
import { formatNumber } from '@/utils/format';

import { contextSelectors, useConversationStore } from '../../../../store';
import TokenDetail from './UsageDetail';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

// Cheap messages don't need a cost callout — only surface it once it's
// expensive enough to matter.
const MIN_DISPLAY_COST = 0.2;

const formatCost = (cost: number) => cost.toFixed(2);

interface UsageProps {
  model: string;
  performance?: ModelPerformance;
  provider: string;
  usage?: ModelUsage;
}

const Usage = memo<UsageProps>(({ model, usage, performance, provider }) => {
  const { t } = useTranslation('chat');
  const onboardingAgentId = useAgentStore(builtinAgentSelectors.webOnboardingAgentId);
  const conversationAgentId = useConversationStore(contextSelectors.agentId);
  const serverDefaultConfiguredModel = useAgentStore((s) => {
    if (!conversationAgentId) return undefined;
    const apiConfig =
      agentByIdSelectors.getAgencyConfigById(conversationAgentId)(s)?.heterogeneousProvider
        ?.apiConfig;
    return apiConfig?.source === 'server-default' ? apiConfig.model : undefined;
  });
  // Credit mode already expresses cost in credits — showing USD alongside would conflict.
  const isShowCredit = useGlobalStore(systemStatusSelectors.isShowCredit);
  const displayModel =
    unwrapServerDefaultHeterogeneousModel(model, serverDefaultConfiguredModel) ?? model;
  const modelCard = useAiInfraStore((s) => {
    const exact = aiModelSelectors.getModelCard(displayModel, provider)(s);
    if (exact || !serverDefaultConfiguredModel) return exact;
    // Server-default messages keep provider as the CLI type (`claude-code` /
    // `codex`), so the catalog card lives under the relay provider id.
    return (
      s.enabledAiModels?.find((item) => item.id === displayModel) ||
      s.builtinAiModelList.find((item) => item.id === displayModel)
    );
  });
  const displayProvider = modelCard?.providerId ?? provider;

  if (!isDev && onboardingAgentId && conversationAgentId === onboardingAgentId) return null;

  // Only remote platform agents (openclaw, hermes) replace the model name with
  // the brand label — they don't expose a real model id. Local CLI agents
  // (claude-code, codex) report their actual model on `turn_metadata` and
  // should keep showing it. Server-default bindings report `lobehub/${id}`
  // (or the legacy `lobehub-default` alias); unwrap to the catalog id so this
  // footer matches what the user selected.
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
      {/* The speed describes how this model ran, so it sits with the model name
          rather than in the token/cost cluster. A spelled-out "tok/s" unit rather
          than an icon: at 12px a gauge glyph is indistinguishable from the
          neighbouring coin, so the reader can't tell what the number measures.
          TTFT rides in the hover instead of taking a second inline slot — it's a
          diagnostic, not an at-a-glance metric. */}
      <Center horizontal gap={6} style={{ fontSize: 12 }}>
        <Center horizontal gap={4}>
          {heteroName || (
            <>
              <ModelIcon model={displayModel} type={'mono'} />
              {modelCard?.displayName || displayModel}
            </>
          )}
        </Center>
        {!!performance?.tps && (
          <>
            <span>·</span>
            <Tooltip
              title={
                <Flexbox gap={6}>
                  <span>{t('messages.tokenDetails.speed.tps.tooltip')}</span>
                  {!!performance.ttft && (
                    <Flexbox horizontal gap={12} justify={'space-between'}>
                      <span>{t('messages.tokenDetails.speed.ttft.title')}</span>
                      <span>{formatNumber(performance.ttft / 1000, 2)}s</span>
                    </Flexbox>
                  )}
                </Flexbox>
              }
            >
              <Center horizontal gap={4}>
                <span>{formatNumber(performance.tps, 1)}</span>
                <span>{t('messages.tokenDetails.speed.tps.title')}</span>
              </Center>
            </Tooltip>
          </>
        )}
      </Center>

      <Center horizontal gap={8}>
        {!!usage?.totalTokens && (
          <TokenDetail
            model={displayModel}
            performance={performance}
            provider={displayProvider}
            usage={usage}
          />
        )}
        {!isShowCredit && !!usage?.cost && usage.cost >= MIN_DISPLAY_COST && (
          <Center horizontal gap={2}>
            <Icon icon={CircleDollarSignIcon} />
            {formatCost(usage.cost)}
          </Center>
        )}
      </Center>
    </Flexbox>
  );
}, isEqual);

export default Usage;
