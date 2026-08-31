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

  return (
    <Section desc={t('share.settings.tools.desc')} title={t('share.settings.tools.title')}>
      {candidateToolIds.length === 0 ? (
        <Text fontSize={12} type={'secondary'}>
          {t('share.settings.tools.empty')}
        </Text>
      ) : (
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          {candidateToolIds.map((toolId) => {
            const availability = getShareToolAvailability(toolId, {
              allowReadMemory: shareConfig.allowReadMemory,
            });
            // A blocked tool can never reach a visitor run, so offer it
            // disabled with an explanation rather than letting the owner
            // "grant" something the server always strips.
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
                  selected={!blocked && selectedToolIds.includes(toolId)}
                  onSelect={blocked ? undefined : () => toggleTool(toolId)}
                />
              </Tooltip>
            );
          })}
        </Flexbox>
      )}
    </Section>
  );
});

ToolsSection.displayName = 'AgentShareToolsSection';

export default ToolsSection;
