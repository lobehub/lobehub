'use client';

import {
  HETEROGENEOUS_TYPE_LABELS,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { Button, Flexbox, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentDriverSelect from '@/features/AgentDriver';
import { buildAgentProfileTabPath } from '@/features/AgentProfileTabs/tabOptions';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';

import AgentExecutionEnvironment from '../ProfileEditor/AgentExecutionEnvironment';
import { AgentModelConfig } from '../ProfileEditor/AgentModelConfig';

const EngineEditor = memo(() => {
  const { t } = useTranslation(['setting', 'agent']);
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const isWorkspaceAgent = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(agentId));
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
      ) : (
        <>
          {configHeading}
          <Flexbox horizontal gap={8} style={{ containerType: 'inline-size' }} wrap={'wrap'}>
            <AgentModelConfig agentId={agentId} />
            <AgentExecutionEnvironment agentId={agentId} />
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
});

EngineEditor.displayName = 'EngineEditor';

export default EngineEditor;
