import { ActionIcon, Center, Empty, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SettingsIcon, WrenchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { buildAgentProfileTabPath } from '@/features/AgentProfileTabs/tabOptions';
import { ScrollSignalProvider } from '@/features/ChatInput/ActionBar/Tools/ScrollSignalContext';
import ToolsList from '@/features/ChatInput/ActionBar/Tools/ToolsList';
import { useControls } from '@/features/ChatInput/ActionBar/Tools/useControls';
import { useEffectiveModel } from '@/features/ChatInput/hooks/useEffectiveModel';
import { createStore, Provider } from '@/features/ChatInput/store';
import { SkillSection } from '@/features/SkillsList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useAgentStore } from '@/store/agent';
import { sidebarRow } from '@/styles/density.stylex';

const styles = stylex.create({
  body: {
    overflowY: 'auto',
    flex: '1',
    minHeight: '0',
    paddingBlock: '8px',
    paddingInline: '4px',
  },
  header: {
    flexShrink: 0,
    paddingBlockStart: sidebarRow.paneBlockStart,
    paddingBlockEnd: '8px',
    paddingInline: sidebarRow.paneInline,
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorFill,
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    minHeight: '0',
  },
});

const ToolsSidebarContent = ({ agentId }: { agentId: string }) => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const { model, provider } = useEffectiveModel(agentId);
  const enableFC = useModelSupportToolUse(model, provider);

  const manageAction = agentId ? (
    <ActionIcon
      aria-label={t('tools.picker.management')}
      icon={SettingsIcon}
      size="small"
      title={t('tools.picker.management')}
      onClick={() => navigate(buildAgentProfileTabPath(agentId, 'tools'))}
    />
  ) : undefined;

  const { enabledSections, isPolicyMenuOpen, marketHeader } = useControls({
    detailPlacement: 'leftTop',
    enabledOnly: true,
    headerAction: manageAction,
  });

  if (!enableFC) {
    return (
      <Center flex={1} padding={24}>
        <Empty description={t('tools.picker.disabled')} icon={WrenchIcon} />
      </Center>
    );
  }

  return (
    <Flexbox className={stylex.props(styles.root).className} gap={0}>
      <div {...stylex.props(styles.header)}>{marketHeader}</div>
      <ScrollSignalProvider className={stylex.props(styles.body).className}>
        <Flexbox gap={12}>
          {enabledSections.map((section) => (
            <SkillSection
              compact
              key={section.key}
              sectionHeader={{ count: section.items.length, title: section.title }}
            >
              <ToolsList
                detailPlacement="leftTop"
                detailPopoverDisabled={isPolicyMenuOpen}
                items={section.items}
              />
            </SkillSection>
          ))}
        </Flexbox>
      </ScrollSignalProvider>
    </Flexbox>
  );
};

const ToolsSection = () => {
  const agentId = useAgentStore((s) => s.activeAgentId) || '';

  return (
    <Provider createStore={() => createStore({ agentId })} key={agentId}>
      <ToolsSidebarContent agentId={agentId} />
    </Provider>
  );
};

export default ToolsSection;
