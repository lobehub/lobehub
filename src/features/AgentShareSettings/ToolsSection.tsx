'use client';

import { getActivePluginIds } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { Section } from './SectionLayout';
import ToolRow from './ToolRow';
import {
  getShareToolAvailability,
  getShareToolCandidateIds,
  getVisitorVisibleEnabledToolIds,
} from './toolVisitorAvailability';
import type { AgentShareConfigPatch, AgentShareConfigState } from './useAgentShare';

interface ToolsSectionProps {
  agentId: string;
  onChange: (patch: AgentShareConfigPatch) => void;
  shareConfig: AgentShareConfigState;
}

/**
 * Whitelist of tools a visitor's run may call. Default-deny: an unchecked tool
 * is stripped by the server gate even if the agent itself has it enabled.
 * High-risk identifiers (device, local system, sandbox, ...) and tools the
 * gate refuses outright (knowledge base, agent documents) are never selectable
 * — see `toolVisitorAvailability`.
 */
const ToolsSection = memo<ToolsSectionProps>(({ agentId, onChange, shareConfig }) => {
  const { t } = useTranslation('agent');

  const agentConfig = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const candidateToolIds = getShareToolCandidateIds(getActivePluginIds(agentConfig?.plugins));
  const selectedToolIds = getVisitorVisibleEnabledToolIds(shareConfig.enabledToolIds);

  // Two buckets, extension-manager style: what visitors already get, then what
  // else could be granted. Toggling moves a tool between them, so the owner
  // reads the effective grant at a glance instead of scanning checkboxes.
  const enabledIds = candidateToolIds.filter(
    (toolId) =>
      selectedToolIds.includes(toolId) &&
      getShareToolAvailability(toolId, { allowReadMemory: shareConfig.allowReadMemory }) !==
        'blocked',
  );
  const availableIds = candidateToolIds.filter((toolId) => !enabledIds.includes(toolId));
  // Rendered as disabled chips (so the owner learns why a configured tool
  // cannot be shared) but excluded from the "not granted" COUNT — a tool the
  // gate refuses outright is never actually grantable, so counting it would
  // overstate how many real choices are left.
  const availableGrantableCount = availableIds.filter(
    (toolId) =>
      getShareToolAvailability(toolId, { allowReadMemory: shareConfig.allowReadMemory }) !==
      'blocked',
  ).length;

  const renderTool = (toolId: string, selected: boolean) => (
    <ToolRow
      agentId={agentId}
      key={toolId}
      selected={selected}
      shareConfig={shareConfig}
      toolId={toolId}
      onChange={onChange}
    />
  );

  return (
    <Section desc={t('share.settings.tools.desc')} title={t('share.settings.tools.title')}>
      {candidateToolIds.length === 0 ? (
        <Text fontSize={12} type={'secondary'}>
          {t('share.settings.tools.empty')}
        </Text>
      ) : (
        <Flexbox gap={16}>
          <Flexbox gap={8}>
            <Text fontSize={12} type={'secondary'}>
              {t('share.settings.tools.grantedGroup', { count: enabledIds.length })}
            </Text>
            {enabledIds.length === 0 ? (
              <Text fontSize={12} type={'secondary'}>
                {t('share.settings.tools.grantedEmpty')}
              </Text>
            ) : (
              <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                {enabledIds.map((toolId) => renderTool(toolId, true))}
              </Flexbox>
            )}
          </Flexbox>
          {availableIds.length > 0 && (
            <Flexbox gap={8}>
              <Text fontSize={12} type={'secondary'}>
                {t('share.settings.tools.availableGroup', { count: availableGrantableCount })}
              </Text>
              <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                {availableIds.map((toolId) => renderTool(toolId, false))}
              </Flexbox>
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Section>
  );
});

ToolsSection.displayName = 'AgentShareToolsSection';

export default ToolsSection;
