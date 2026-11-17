'use client';

import {
  HETEROGENEOUS_TYPE_LABELS,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { Alert, Button, Flexbox, Text } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { ChevronDown } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AGENT_SHARE_ALLOWED_PROVIDERS } from '@/business/agent-share';
import { useAgentShareSupported } from '@/business/client/useAgentShareSupported';
import { ModelIcon } from '@/components/LobeIcons';
import { FORM_STYLE } from '@/const/layoutTokens';
import AgentDriverSelect from '@/features/AgentDriver';
import { buildAgentProfileTabPath } from '@/features/AgentProfileTabs/tabOptions';
import ReasoningEffortSelect from '@/features/ModelSelect/ReasoningEffortSelect';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import WorkspaceAgentDevicePolicy from '../ProfileEditor/WorkspaceAgentDevicePolicy';
import { WorkspaceAgentModelPolicy } from '../ProfileEditor/WorkspaceAgentModelPolicy';

const EngineEditor = memo(() => {
  const { t } = useTranslation(['setting', 'agent']);
  const form = useForm();
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const { isShared } = useAgentShareSupported(agentId);
  const chatModels = useEnabledChatModels();
  const enabledList =
    isShared && AGENT_SHARE_ALLOWED_PROVIDERS
      ? chatModels.filter((provider) => AGENT_SHARE_ALLOWED_PROVIDERS?.includes(provider.id))
      : undefined;
  const selectedModel = useAiInfraStore(
    aiModelSelectors.getEnabledModelById(config?.model ?? '', config?.provider ?? ''),
  );
  const isWorkspaceAgent = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const heterogeneousProvider = config?.agencyConfig?.heterogeneousProvider;
  const isRemoteHetero =
    isHeterogeneous &&
    !!heterogeneousProvider &&
    isRemoteHeterogeneousType(heterogeneousProvider.type);
  const driverName = heterogeneousProvider
    ? HETEROGENEOUS_TYPE_LABELS[heterogeneousProvider.type]
    : t('settingAgent.driver.harness');
  // What is configured below depends on the driver above, so the section is named after it.
  const configTitle = t('settingAgent.engine.configTitle', { name: driverName });

  // The driver is the one big choice on this page, so every option is laid out in view with what
  // the current one means for you above them.
  const driverForm = (
    <Flexbox gap={16}>
      <Flexbox gap={4}>
        <Text style={{ fontSize: 16, fontWeight: 600 }}>{t('settingAgent.driver.title')}</Text>
        <Text type={'secondary'}>
          {t(
            heterogeneousProvider
              ? 'settingAgent.driver.brings.hetero'
              : 'settingAgent.driver.brings.harness',
          )}
        </Text>
      </Flexbox>
      <AgentDriverSelect
        agentId={agentId}
        canEdit={canEdit && !isRemoteHetero && !isWorkspaceAgent}
      />
    </Flexbox>
  );

  const configHeading = (
    <Text fontSize={16} style={{ marginBlockStart: 8 }} weight={600}>
      {configTitle}
    </Text>
  );

  const modelForm = (
    <Form
      collapsible={false}
      form={form}
      itemsType={'group'}
      variant={'filled'}
      items={[
        {
          children: isHeterogeneous
            ? []
            : [
                {
                  children: (
                    <ModelSwitchPanel
                      enabledList={enabledList}
                      model={config?.model}
                      open={canEdit ? undefined : false}
                      openOnHover={false}
                      placement={'bottomRight'}
                      provider={config?.provider}
                      notice={
                        enabledList && (
                          <Alert
                            showIcon
                            title={t('share.settings.modelRestriction.title', { ns: 'agent' })}
                            type={'info'}
                            description={t('share.settings.modelRestriction.description', {
                              ns: 'agent',
                            })}
                          />
                        )
                      }
                      onModelChange={async (value) => {
                        if (canEdit) await updateAgentConfigById(agentId, value);
                      }}
                    >
                      <Button disabled={!canEdit}>
                        <ModelIcon model={config?.model} size={20} />
                        {selectedModel?.displayName || config?.model}
                        <ChevronDown size={14} />
                      </Button>
                    </ModelSwitchPanel>
                  ),
                  desc: t('settingAgent.model.desc'),
                  label: t('settingAgent.model.title'),
                  layout: 'horizontal' as const,
                  minWidth: undefined,
                },
                ...(config?.model && config.provider
                  ? [
                      {
                        children: (
                          <ReasoningEffortSelect
                            disabled={!canEdit}
                            model={config.model}
                            provider={config.provider}
                          />
                        ),
                        desc: t('settingAgent.reasoning.desc'),
                        label: t('settingAgent.reasoning.title'),
                        layout: 'horizontal' as const,
                        minWidth: undefined,
                      },
                    ]
                  : []),
              ],
          title: configTitle,
        } satisfies FormGroupItem,
      ]}
      {...FORM_STYLE}
    />
  );

  return (
    <Flexbox gap={32} paddingBlock={'8px 48px'}>
      <Flexbox gap={4}>
        <Text fontSize={24} weight={600}>
          {t('settingAgent.engine.title')}
        </Text>
        <Text type={'secondary'}>{t('settingAgent.engine.desc')}</Text>
      </Flexbox>
      {!isWorkspaceAgent ? driverForm : null}
      {isHeterogeneous ? (
        // Where it runs lives on its own page, so say so rather than leave this one bare.
        <Flexbox horizontal align={'center'} gap={4}>
          <Text type={'secondary'}>
            {t('settingAgent.engine.heteroHint', { name: driverName })}
          </Text>
          <Button
            size={'small'}
            type={'text'}
            onClick={() => navigate(buildAgentProfileTabPath(agentId, 'environment'))}
          >
            {t('tab.environment', { ns: 'chat' })}
          </Button>
        </Flexbox>
      ) : isWorkspaceAgent ? (
        <>
          {configHeading}
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            <WorkspaceAgentModelPolicy agentId={agentId} />
            <WorkspaceAgentDevicePolicy agentId={agentId} />
          </Flexbox>
        </>
      ) : (
        modelForm
      )}
    </Flexbox>
  );
});

EngineEditor.displayName = 'EngineEditor';

export default EngineEditor;
