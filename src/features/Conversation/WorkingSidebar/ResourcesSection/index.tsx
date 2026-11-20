import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useDensityTokens } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';

import AgentDocumentsGroup, { type ResourceFilter } from './AgentDocumentsGroup';
import SkillsGroup from './SkillsGroup';

const styles = stylex.create({
  pane: {
    paddingBlockStart: sidebarRow.paneBlockStart,
    paddingBlockEnd: sidebarRow.paneBlockEnd,
    paddingInline: sidebarRow.paneInline,
  },
});

interface ResourcesSectionProps {
  /** Bound remote device id (device mode); skills are then scanned over RPC. */
  deviceId?: string;
  /**
   * Whether this pane is actually visible (panel open + this tab active).
   * Gates the agent-document fetch so a collapsed sidebar doesn't pull the full
   * list on conversation enter.
   */
  enabled?: boolean;
  /** Which resource kind this pane shows — skills / documents / web are separate tabs. */
  filter: ResourceFilter;
}

const ResourcesSection = memo<ResourcesSectionProps>(({ deviceId, enabled = true, filter }) => {
  const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  // Resolve the cwd the same way the runtime bar / WorkingSidebar do
  // (`useEffectiveWorkingDirectory`). The old `topicCwd || agentCwd` pattern
  // missed `workingDirByDevice[deviceId]` / `device.defaultCwd`, so a
  // device-bound agent resolved to `undefined` here and the skills fetch never
  // fired even though `deviceId` was set.
  const workingDirectory = useEffectiveWorkingDirectory(activeAgentId);
  const { sectionGap } = useDensityTokens();

  return (
    <Flexbox
      // The document tree owns its insets: its toolbar follows the pane toolbar
      // and its rows sit inside pierre's own inline padding.
      className={filter === 'documents' ? undefined : stylex.props(styles.pane).className}
      data-testid={`workspace-${filter}`}
      flex={1}
      gap={sectionGap}
      style={{ minHeight: 0 }}
    >
      {isHetero && workingDirectory && filter === 'skills' && (
        <SkillsGroup deviceId={deviceId} workingDirectory={workingDirectory} />
      )}
      {!isHetero && (
        <AgentDocumentsGroup
          compact
          activeFilter={filter}
          deviceId={deviceId}
          enabled={enabled}
          showFilterTabs={false}
          style={{ flex: 1, minHeight: 0 }}
          workingDirectory={workingDirectory}
        />
      )}
    </Flexbox>
  );
});

ResourcesSection.displayName = 'ResourcesSection';

export default ResourcesSection;
