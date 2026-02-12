import { Center, Flexbox, Icon } from '@lobehub/ui';
import { GlobeOffIcon } from '@lobehub/ui/icons';
import { Divider } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { SparkleIcon } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type SearchMode } from '@/types/search';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import FCSearchModel from './FCSearchModel';
import ModelBuiltinSearch from './ModelBuiltinSearch';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    background: ${cssVar.colorFillTertiary};
  `,
  check: css`
    margin-inline-start: 12px;
    font-size: 16px;
    color: ${cssVar.colorPrimary};
  `,
  description: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  icon: css`
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  option: css`
    cursor: pointer;

    width: 100%;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  title: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface NetworkOption {
  description: string;
  disable?: boolean;
  icon: LucideIcon;
  label: string;
  value: SearchMode;
}

const Item = memo<NetworkOption>(({ value, description, icon, label }) => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const mode = useAgentStore((s) => chatConfigByIdSelectors.getSearchModeById(agentId)(s));

  return (
    <Flexbox
      horizontal
      align={'flex-start'}
      className={cx(styles.option, mode === value && styles.active)}
      gap={12}
      key={value}
      onClick={async () => {
        await updateAgentChatConfig({ searchMode: value });
      }}
    >
      <Center className={styles.icon} flex={'none'} height={32} width={32}>
        <Icon icon={icon} />
      </Center>
      <Flexbox flex={1}>
        <div className={styles.title}>{label}</div>
        <div className={styles.description}>{description}</div>
      </Flexbox>
    </Flexbox>
  );
});

const Controls = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();

  const [model, provider, useModelBuiltinSearch, searchMode] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    chatConfigByIdSelectors.getUseModelBuiltinSearchById(agentId)(s),
    chatConfigByIdSelectors.getChatConfigById(agentId)(s).searchMode,
  ]);

  const supportFC = useAiInfraStore(aiModelSelectors.isModelSupportToolUse(model, provider));
  const isProviderHasBuiltinSearchConfig = useAiInfraStore(
    aiProviderSelectors.isProviderHasBuiltinSearchConfig(provider),
  );
  const isModelHasBuiltinSearchConfig = useAiInfraStore(
    aiModelSelectors.isModelHasBuiltinSearchConfig(model, provider),
  );
  const isModelBuiltinSearchInternal = useAiInfraStore(
    aiModelSelectors.isModelBuiltinSearchInternal(model, provider),
  );
  const modelBuiltinSearchImpl = useAiInfraStore(
    aiModelSelectors.modelBuiltinSearchImpl(model, provider),
  );

  useEffect(() => {
    if (isModelBuiltinSearchInternal && (searchMode ?? 'off') === 'off') {
      updateAgentChatConfig({ searchMode: 'auto' });
    }
  }, [isModelBuiltinSearchInternal, searchMode, updateAgentChatConfig]);

  const options: NetworkOption[] = isModelBuiltinSearchInternal
    ? [
        {
          description: t('search.mode.auto.desc'),
          icon: SparkleIcon,
          label: t('search.mode.auto.title'),
          value: 'auto',
        },
      ]
    : [
        {
          description: t('search.mode.off.desc'),
          icon: GlobeOffIcon,
          label: t('search.mode.off.title'),
          value: 'off',
        },
        {
          description: t('search.mode.auto.desc'),
          icon: SparkleIcon,
          label: t('search.mode.auto.title'),
          value: 'auto',
        },
      ];

  const showModelBuiltinSearch =
    searchMode !== 'off' &&
    !isModelBuiltinSearchInternal &&
    (isModelHasBuiltinSearchConfig || isProviderHasBuiltinSearchConfig);

  const showFCSearchModel =
    !supportFC &&
    (!modelBuiltinSearchImpl || (!isModelBuiltinSearchInternal && !useModelBuiltinSearch));

  const showDivider = showModelBuiltinSearch || showFCSearchModel;

  return (
    <Flexbox gap={4}>
      {options.map((option) => (
        <Item {...option} key={option.value} />
      ))}
      {showDivider && <Divider style={{ margin: 0 }} />}
      {showModelBuiltinSearch && <ModelBuiltinSearch />}
      {showFCSearchModel && <FCSearchModel />}
    </Flexbox>
  );
});

export default Controls;
