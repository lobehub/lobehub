import { Center, Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, Settings2Icon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ActionPopover from '@/features/ChatInput/ActionBar/components/ActionPopover';
import { conversationSelectors, useConversationStore } from '@/features/Conversation';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import ControlsForm from '@/features/ModelSwitchPanel/components/ControlsForm';
import { usePermission } from '@/hooks/usePermission';
import ImageModelItem from '@/routes/(main)/(create)/image/features/ConfigPanel/components/ModelSelect/ImageModelItem';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

export interface CopilotModelSelectProps {
  disabled?: boolean;
  mode?: 'chat' | 'image';
  /** Per-turn selection. When supplied, the Agent default is never mutated. */
  model?: string;
  onModelChange?: (params: { model: string; provider: string }) => void | Promise<void>;
  provider?: string;
}

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
    border-radius: 6px;

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

const CopilotModelSelect = memo<CopilotModelSelectProps>((props) => {
  const {
    disabled = false,
    mode = 'chat',
    model: modelProp,
    onModelChange,
    provider: providerProp,
  } = props;
  const { allowed: canEdit } = usePermission('edit_own_content');
  const { t } = useTranslation('editor');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const agentId = useConversationStore(conversationSelectors.agentId);
  const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);

  const [agentModel, agentProvider, updateAgentConfigById] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    s.updateAgentConfigById,
  ]);
  // Supplying either prop opts into the per-turn path, including an explicit
  // undefined while the image model list is still loading. Checking the prop
  // keys instead of their values prevents a temporarily empty image selection
  // from falling back to mutating the Agent defaults.
  const isControlled = 'model' in props || 'provider' in props;
  const isImageMode = mode === 'image';
  const model = isImageMode ? modelProp : (modelProp ?? agentModel);
  const provider = isImageMode ? providerProp : (providerProp ?? agentProvider);

  const enabledModel = useAiInfraStore(
    aiModelSelectors.getEnabledModelById(model || '', provider || ''),
  );
  // Reasoning-family params are hidden below (hideReasoningParams), so gate on
  // the non-reasoning subset to avoid an empty popover for reasoning-only models
  const isModelHasExtendParams = useAiInfraStore(
    aiModelSelectors.isModelHasNonReasoningExtendParams(model || '', provider || ''),
  );

  const displayName =
    enabledModel?.displayName ||
    model ||
    (isImageMode ? t('copilot.rewrite.imageModel') : undefined);

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      if (!canEdit || disabled) return;
      if (isControlled) {
        await onModelChange?.(params);
        return;
      }
      await updateAgentConfigById(agentId, params);
    },
    [agentId, canEdit, disabled, isControlled, onModelChange, updateAgentConfigById],
  );

  return (
    <Flexbox horizontal align={'center'}>
      <ModelSwitchPanel
        ModelItemComponent={isImageMode ? ImageModelItem : undefined}
        enabledList={isImageMode ? enabledImageModelList : undefined}
        model={model}
        openOnHover={false}
        pricingMode={isImageMode ? 'image' : undefined}
        provider={provider}
        onModelChange={handleModelChange}
      >
        <Center
          horizontal
          className={styles.trigger}
          height={28}
          paddingInline={6}
          style={
            canEdit && !disabled
              ? undefined
              : { cursor: 'not-allowed', opacity: 0.5, pointerEvents: 'none' }
          }
        >
          <Flexbox horizontal align={'center'} gap={2}>
            <span className={styles.name}>{displayName}</span>
            <ChevronDownIcon className={styles.chevron} size={12} />
          </Flexbox>
        </Center>
      </ModelSwitchPanel>
      {isModelHasExtendParams && !isControlled && (
        <ActionPopover
          content={<ControlsForm hideReasoningParams disabled={!canEdit} />}
          minWidth={350}
          open={settingsOpen}
          placement={'topRight'}
          trigger={'click'}
          onOpenChange={(open) => {
            if (!canEdit || disabled) return;

            setSettingsOpen(open);
          }}
        >
          <ActionIcon
            disabled={!canEdit}
            icon={Settings2Icon}
            size={{ blockSize: 28, size: 16 }}
            onClick={() => {
              if (!canEdit || disabled) return;

              setSettingsOpen(true);
            }}
          />
        </ActionPopover>
      )}
    </Flexbox>
  );
});

CopilotModelSelect.displayName = 'CopilotModelSelect';

export default CopilotModelSelect;
