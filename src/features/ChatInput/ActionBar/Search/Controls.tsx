import { Center, Divider, Flexbox, Icon } from '@lobehub/ui';
import { GlobeOffIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type LucideIcon } from 'lucide-react';
import { SparkleIcon } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type SearchMode } from '@/types/search';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import FCSearchModel from './FCSearchModel';
import ModelBuiltinSearch from './ModelBuiltinSearch';

const styles = stylex.create({
  active: { backgroundColor: cssVar.colorFillTertiary, backgroundImage: 'none' },
  description: { fontSize: '12px', color: cssVar.colorTextDescription },
  icon: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillTertiary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  option: {
    cursor: 'pointer',
    width: '100%',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  title: { fontSize: '14px', fontWeight: 500, color: cssVar.colorText },
});

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
  const { allowed: canCreate } = usePermission('create_content');

  return (
    <Flexbox
      horizontal
      align={'flex-start'}
      className={stylex.props(styles.option, mode === value && styles.active).className}
      gap={12}
      key={value}
      style={{
        cursor: canCreate ? undefined : 'not-allowed',
        opacity: canCreate ? undefined : 0.5,
      }}
      onClick={async () => {
        if (!canCreate) return;
        await updateAgentChatConfig({ searchMode: value });
      }}
    >
      <Center className={stylex.props(styles.icon).className} flex={'none'} height={32} width={32}>
        <Icon icon={icon} />
      </Center>
      <Flexbox flex={1}>
        <div {...stylex.props(styles.title)}>{label}</div>
        <div {...stylex.props(styles.description)}>{description}</div>
      </Flexbox>
    </Flexbox>
  );
});

/**
 * Search settings that are only meaningful once web search is on: which engine
 * answers (app tool vs the model's built-in search) and which model runs the
 * function-calling search. Extracted so the search capability row in the
 * chat-input Tools popover can host it beside the Auto/Disable policy.
 */
export const SearchAdvancedControls = memo(() => {
  const agentId = useAgentId();
  const { allowed: canCreate } = usePermission('create_content');

  const { model, provider } = useEffectiveModel(agentId);
  const [useModelBuiltinSearch, searchMode] = useAgentStore((s) => [
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

  const showModelBuiltinSearch =
    searchMode !== 'off' &&
    !isModelBuiltinSearchInternal &&
    (isModelHasBuiltinSearchConfig || isProviderHasBuiltinSearchConfig);

  const showFCSearchModel =
    !supportFC &&
    (!modelBuiltinSearchImpl || (!isModelBuiltinSearchInternal && !useModelBuiltinSearch));

  if (!showModelBuiltinSearch && !showFCSearchModel) return null;

  return (
    <>
      <Divider style={{ margin: 0 }} />
      {showModelBuiltinSearch && <ModelBuiltinSearch disabled={!canCreate} />}
      {showFCSearchModel && <FCSearchModel disabled={!canCreate} />}
    </>
  );
});

SearchAdvancedControls.displayName = 'SearchAdvancedControls';

const Controls = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const { allowed: canCreate } = usePermission('create_content');

  const { model, provider } = useEffectiveModel(agentId);
  const searchMode = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).searchMode,
  );

  const isModelBuiltinSearchInternal = useAiInfraStore(
    aiModelSelectors.isModelBuiltinSearchInternal(model, provider),
  );

  useEffect(() => {
    if (!canCreate) return;
    if (isModelBuiltinSearchInternal && (searchMode ?? 'auto') === 'off') {
      // Auto-correction for a model whose search can't be turned off — the user
      // didn't touch the toggle, so a rejected write must stay silent instead of
      // reporting a change they never made (automatic corrections must not trigger phantom save-error toasts).
      updateAgentChatConfig({ searchMode: 'auto' }, { showErrorMessage: false });
    }
  }, [canCreate, isModelBuiltinSearchInternal, searchMode, updateAgentChatConfig]);

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

  return (
    <Flexbox gap={4}>
      {options.map((option) => (
        <Item {...option} key={option.value} />
      ))}
      <SearchAdvancedControls />
    </Flexbox>
  );
});

export default Controls;
