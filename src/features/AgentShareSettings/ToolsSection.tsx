'use client';

import { getActivePluginIds } from '@lobechat/types';
import { Flexbox, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PluginTag from '@/features/ProfileEditor/PluginTag';
import type { AgentShareConfigPatchInput } from '@/services/agentShare';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { Section } from './SectionLayout';
import {
  getShareToolCandidateIds,
  getVisitorVisibleEnabledToolIds,
  isToolAvailableToVisitors,
} from './toolVisitorAvailability';
import type { AgentShareConfigState } from './useAgentShare';

interface ToolsSectionProps {
  agentId: string;
  onChange: (patch: AgentShareConfigPatchInput) => void;
  shareConfig: AgentShareConfigState;
}

/**
 * Whitelist of tools a visitor's run may call. Default-deny: an unchecked tool
 * is stripped by the server gate even if the agent itself has it enabled.
 * High-risk identifiers (device, local system, sandbox, ...) are never listed —
 * the server refuses them for share runs regardless of what is stored here.
 */
const ToolsSection = memo<ToolsSectionProps>(({ agentId, onChange, shareConfig }) => {
  const { t } = useTranslation('agent');

  const agentConfig = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const candidateToolIds = getShareToolCandidateIds(getActivePluginIds(agentConfig?.plugins));
  const selectedToolIds = getVisitorVisibleEnabledToolIds(shareConfig.enabledToolIds);

  const toggleTool = (toolId: string) => {
    onChange({
      enabledToolIds: selectedToolIds.includes(toolId)
        ? selectedToolIds.filter((id) => id !== toolId)
        : [...selectedToolIds, toolId],
    });
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
            // A builtin absent from the server's visitor allowlist can never
            // reach a visitor run, so offer it disabled with an explanation
            // rather than letting the owner "grant" something always stripped.
            const availableToVisitors = isToolAvailableToVisitors(toolId);

            return (
              <Tooltip
                key={toolId}
                title={
                  availableToVisitors ? undefined : t('share.settings.tools.notAvailableToVisitors')
                }
              >
                <PluginTag
                  selectable
                  useAllMetaList
                  agentId={agentId}
                  disabled={!availableToVisitors}
                  pluginId={toolId}
                  selected={availableToVisitors && selectedToolIds.includes(toolId)}
                  onSelect={availableToVisitors ? () => toggleTool(toolId) : undefined}
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
