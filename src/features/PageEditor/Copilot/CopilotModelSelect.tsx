import { ActionIcon, Center, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, Settings2Icon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import ActionPopover from '@/features/ChatInput/ActionBar/components/ActionPopover';
import { conversationSelectors, useConversationStore } from '@/features/Conversation';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import ControlsForm from '@/features/ModelSwitchPanel/components/ControlsForm';
import { usePermission } from '@/hooks/usePermission';
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
    border-radius: 6px;

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

const CopilotModelSelect = memo(() => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const agentId = useConversationStore(conversationSelectors.agentId);

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
      if (!canEdit) return;

      await updateAgentConfigById(agentId, params);
    },
    [canEdit, agentId, updateAgentConfigById],
  );

  return (
    <Flexbox horizontal align={'center'}>
      <ModelSwitchPanel
        model={model}
        openOnHover={false}
        provider={provider}
        onModelChange={handleModelChange}
      >
        <Center
          horizontal
          className={styles.trigger}
          height={28}
          paddingInline={6}
          style={
            canEdit ? undefined : { cursor: 'not-allowed', opacity: 0.5, pointerEvents: 'none' }
          }
        >
          <Flexbox horizontal align={'center'} gap={2}>
            <span className={styles.name}>{displayName}</span>
            <ChevronDownIcon className={styles.chevron} size={12} />
          </Flexbox>
        </Center>
      </ModelSwitchPanel>
      {isModelHasExtendParams && (
        <ActionPopover
          content={<ControlsForm disabled={!canEdit} />}
          minWidth={350}
          open={settingsOpen}
          placement={'topRight'}
          trigger={'click'}
          onOpenChange={(open) => {
            if (!canEdit) return;

            setSettingsOpen(open);
          }}
        >
          <ActionIcon
            disabled={!canEdit}
            icon={Settings2Icon}
            size={{ blockSize: 28, size: 16 }}
            onClick={() => {
              if (!canEdit) return;

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
