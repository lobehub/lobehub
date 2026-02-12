import { ModelIcon } from '@lobehub/icons';
import { Center, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Settings2Icon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from '../../hooks/useAgentId';
import Action from '../components/Action';
import { useActionBarContext } from '../context';
import ControlsForm from './ControlsForm';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    border-radius: 24px;
    background: ${cssVar.colorFillTertiary};
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
  modelWithControl: css`
    border-radius: 24px;

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,

  video: css`
    overflow: hidden;
    border-radius: 24px;
  `,
}));

const ModelSwitch = memo(() => {
  const { t } = useTranslation('chat');
  const { dropdownPlacement } = useActionBarContext();

  const agentId = useAgentId();
  const [model, provider, updateAgentConfigById] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    s.updateAgentConfigById,
  ]);

  const isModelHasExtendParams = useAiInfraStore(
    aiModelSelectors.isModelHasExtendParams(model, provider),
  );

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      await updateAgentConfigById(agentId, params);
    },
    [agentId, updateAgentConfigById],
  );

  return (
    <Flexbox horizontal align={'center'} className={isModelHasExtendParams ? styles.container : ''}>
      <ModelSwitchPanel
        model={model}
        placement={dropdownPlacement}
        provider={provider}
        onModelChange={handleModelChange}
      >
        <Center
          className={cx(styles.model, isModelHasExtendParams && styles.modelWithControl)}
          height={36}
          width={36}
        >
          <div className={styles.icon}>
            <ModelIcon model={model} size={22} />
          </div>
        </Center>
      </ModelSwitchPanel>

      {isModelHasExtendParams && (
        <Action
          icon={Settings2Icon}
          showTooltip={false}
          style={{ borderRadius: 24, marginInlineStart: -4 }}
          title={t('extendParams.title')}
          popover={{
            content: <ControlsForm />,
            minWidth: 350,
            placement: 'topLeft',
          }}
        />
      )}
    </Flexbox>
  );
});

ModelSwitch.displayName = 'ModelSwitch';

export default ModelSwitch;
