import { ModelIcon } from '@lobehub/icons';
import { Center } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, useCallback } from 'react';

import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from '../../hooks/useAgentId';
import { useActionBarContext } from '../context';
import ControlsForm from './ControlsForm';

const styles = createStaticStyles(({ css, cssVar }) => ({
  extraControls: css`
    padding: 8px;

    .ant-form-item:first-child {
      padding-block: 0 4px;
    }

    .ant-form-item:last-child {
      padding-block: 4px 0;
    }

    .ant-divider {
      display: none;
    }
  `,
  icon: cx(
    'model-switch',
    css`
      transition: scale 400ms cubic-bezier(0.215, 0.61, 0.355, 1);
    `,
  ),
  model: css`
    cursor: pointer;
    border-radius: 24px;

    :hover {
      background: ${cssVar.colorFillSecondary};
    }

    :active {
      .model-switch {
        scale: 0.8;
      }
    }
  `,
}));

const ControlsSection = memo<{ model: string; provider: string }>(({ model, provider }) => {
  const isModelHasExtendParams = useAiInfraStore(
    aiModelSelectors.isModelHasExtendParams(model, provider),
  );

  if (!isModelHasExtendParams) return null;

  return (
    <div className={styles.extraControls}>
      <ControlsForm model={model} provider={provider} />
    </div>
  );
});

ControlsSection.displayName = 'ControlsSection';

const ModelSwitch = memo(() => {
  const { dropdownPlacement, borderRadius } = useActionBarContext();

  const agentId = useAgentId();
  const [model, provider, updateAgentConfigById] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    s.updateAgentConfigById,
  ]);

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      await updateAgentConfigById(agentId, params);
    },
    [agentId, updateAgentConfigById],
  );

  const renderControls = useCallback((modelId: string, providerId: string): ReactNode => {
    const hasExtendParams = aiModelSelectors.isModelHasExtendParams(
      modelId,
      providerId,
    )(useAiInfraStore.getState());

    if (!hasExtendParams) return null;

    return <ControlsSection model={modelId} provider={providerId} />;
  }, []);

  return (
    <ModelSwitchPanel
      extraControls={renderControls}
      model={model}
      placement={dropdownPlacement}
      provider={provider}
      onModelChange={handleModelChange}
    >
      <Center className={styles.model} height={36} style={borderRadius ? { borderRadius } : undefined} width={36}           >
        <div className={styles.icon}>
          <ModelIcon model={model} size={22} />
        </div>
      </Center>
    </ModelSwitchPanel>
  );
});

ModelSwitch.displayName = 'ModelSwitch';

export default ModelSwitch;
