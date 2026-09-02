'use client';

import { getActivePluginIds } from '@lobechat/types';
import { Flexbox, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PluginTag from '@/features/ProfileEditor/PluginTag';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { Section } from './SectionLayout';
import {
  getShareToolAvailability,
  getShareToolCandidateIds,
  getVisitorVisibleEnabledToolIds,
  toggleShareToolId,
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

  const toggleTool = (toolId: string) => {
    // Functional patch: resolved against the latest known config at send time,
    // so toggling two tools in quick succession composes instead of the second
    // payload overwriting the first. Composing over the FULL persisted array
    // (not `selectedToolIds`, which is display-filtered) keeps ids this picker
    // does not render from being wiped.
    onChange((current) => ({
      enabledToolIds: toggleShareToolId(current.enabledToolIds, toolId),
    }));
  };

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

  const renderTool = (toolId: string, selected: boolean) => {
    const availability = getShareToolAvailability(toolId, {
      allowReadMemory: shareConfig.allowReadMemory,
    });
    // A blocked tool can never reach a visitor run, so offer it disabled with
    // an explanation rather than letting the owner "grant" something the
    // server always strips.
    const blocked = availability === 'blocked';

    return (
      <Tooltip
        key={toolId}
        title={
          blocked
            ? t('share.settings.tools.notAvailableToVisitors')
            : availability === 'needsMemoryPermission'
              ? t('share.settings.tools.needsMemoryPermission')
              : undefined
        }
      >
        <PluginTag
          selectable
          useAllMetaList
          agentId={agentId}
          disabled={blocked}
          pluginId={toolId}
          selected={selected}
          onSelect={blocked ? undefined : () => toggleTool(toolId)}
        />
      </Tooltip>
    );
  };

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
                {t('share.settings.tools.availableGroup', { count: availableIds.length })}
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
