import { Center, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, Settings2Icon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Action from '@/features/ChatInput/ActionBar/components/Action';
import ControlsForm from '@/features/ChatInput/ActionBar/Model/ControlsForm';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  name: css`
    overflow: hidden;

    max-width: 120px;

    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  trigger: css`
    cursor: pointer;
    border-radius: 8px;

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface CopilotModelSelectorProps {
  agentId: string;
}

const CopilotModelSelector = memo<CopilotModelSelectorProps>(({ agentId }) => {
  const { t } = useTranslation('chat');

  const [model, provider, updateAgentConfigById] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    s.updateAgentConfigById,
  ]);

  const enabledModel = useAiInfraStore(aiModelSelectors.getEnabledModelById(model, provider));
  const isModelHasExtendParams = useAiInfraStore(
    aiModelSelectors.isModelHasExtendParams(model, provider),
  );

  const displayName = enabledModel?.displayName || model;

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      await updateAgentConfigById(agentId, params);
    },
    [agentId, updateAgentConfigById],
  );

  return (
    <Flexbox horizontal align={'center'}>
      <ModelSwitchPanel model={model} provider={provider} onModelChange={handleModelChange}>
        <Center horizontal className={styles.trigger} height={36} paddingInline={8}>
          <Flexbox horizontal align={'center'} gap={2}>
            <span className={styles.name}>{displayName}</span>
            <ChevronDownIcon className={styles.chevron} size={12} />
          </Flexbox>
        </Center>
      </ModelSwitchPanel>
      {isModelHasExtendParams && (
        <Action
          icon={Settings2Icon}
          showTooltip={false}
          style={{ borderRadius: 8 }}
          title={t('extendParams.title')}
          popover={{
            content: <ControlsForm />,
            minWidth: 350,
            placement: 'topRight',
          }}
        />
      )}
    </Flexbox>
  );
});

CopilotModelSelector.displayName = 'CopilotModelSelector';

export default CopilotModelSelector;
