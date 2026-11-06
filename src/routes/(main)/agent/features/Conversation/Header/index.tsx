'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
import { AgentMigrationBadge, useAgentTransferJob } from '@/features/AgentTransferMigration';
import { useAgentContext } from '@/features/Conversation/useAgentContext';
import NavHeader from '@/features/NavHeader';
import OpenInAppButton from '@/features/OpenInAppButton';
import TopicCommentButton from '@/features/TopicComment/TopicCommentButton';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useElectronStore } from '@/store/electron';

import HeaderActions from './HeaderActions';
import ShareButton from './ShareButton';
import Tags from './Tags';
import TerminalPanelToggle from './TerminalPanelToggle';
import WorkingPanelToggle from './WorkingPanelToggle';

// Below this column width the header is a solid in-flow bar with a bottom
// border; at or above it, the header floats above the full-bleed message
// stream (Codex-style): the 960px reading column stays clear of the floating
// slots, which keep their own opaque backing for when content scrolls under.
const FLOATING_HEADER_QUERY = '@container agent-chat-layout (min-width: 1200px)';

const headerStyles = stylex.create({
  container: {
    position: { default: 'relative', [FLOATING_HEADER_QUERY]: 'absolute' },
    zIndex: { default: null, [FLOATING_HEADER_QUERY]: 10 },
    insetBlockStart: { default: null, [FLOATING_HEADER_QUERY]: 0 },
    insetInline: { default: null, [FLOATING_HEADER_QUERY]: 0 },
    pointerEvents: { default: null, [FLOATING_HEADER_QUERY]: 'none' },
    containerName: 'agent-conv-header',
    containerType: 'inline-size',
    borderBlockEndWidth: { default: '1px', [FLOATING_HEADER_QUERY]: 0 },
    borderBlockEndStyle: { default: 'solid', [FLOATING_HEADER_QUERY]: 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: { default: cssVar.colorBgContainer, [FLOATING_HEADER_QUERY]: 'transparent' },
    backgroundImage: 'none',
  },
  leftContent: {
    overflow: 'hidden',
    flexGrow: { default: 1, [FLOATING_HEADER_QUERY]: 0 },
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: 0,
    borderRadius: { default: null, [FLOATING_HEADER_QUERY]: cssVar.borderRadius },
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  rightContent: {
    borderRadius: { default: null, [FLOATING_HEADER_QUERY]: cssVar.borderRadius },
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  slotLeft: {
    pointerEvents: { default: null, [FLOATING_HEADER_QUERY]: 'auto' },
    overflow: { default: 'hidden', [FLOATING_HEADER_QUERY]: 'visible' },
    // Hug the title pill so the transparent middle stays click-through;
    // kept narrow so the floating pill covers less of the stream below
    flexGrow: { default: 1, [FLOATING_HEADER_QUERY]: 0 },
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: 0,
    maxWidth: { default: null, [FLOATING_HEADER_QUERY]: '220px' },
  },
  // Migration chip, narrow/solid mode: in-flow at the head of the right-hand
  // action group, so it reads as a status alongside the actions and can never
  // collide with the (uncapped) title. Hidden once the header switches to
  // floating mode (the centered overlay takes over).
  migrationChipInline: {
    flexShrink: 0,
    display: { default: null, [FLOATING_HEADER_QUERY]: 'none' },
  },
  // Migration chip, wide/floating mode: centered against the whole header row
  // (not the leftover space between slots, which skews with title width). The
  // wrapper is click-through; the chip re-enables its own pointer events.
  // Collisions can't happen here — the floating title pill is capped narrow.
  migrationChipOverlay: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 11,
    insetBlockStart: 0,
    insetInline: 0,
    display: { default: 'none', [FLOATING_HEADER_QUERY]: 'flex' },
    alignItems: 'center',
    justifyContent: 'center',
    height: '44px',
  },
  slotRight: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    minWidth: 0,
    pointerEvents: { default: null, [FLOATING_HEADER_QUERY]: 'auto' },
  },
});

const Header = memo(() => {
  const { agentId, topicId } = useAgentContext();
  // No home/desktop fallback: the IDE button should only show up once the user
  // explicitly picked a working directory (topic / agent / device default).
  const workingDirectory = useEffectiveWorkingDirectory(agentId || undefined, {
    homeFallback: false,
    topicId,
  });
  const splitView = useElectronStore((s) => s.splitView);
  const agentMeta = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentMetaById(agentId)(s) : undefined,
  );
  const isLocalSystemEnabled = useAgentStore((s) =>
    agentId ? chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(s) : false,
  );

  // History-backfill chip in the center slot; the hook shares one SWR key with
  // the rest of the migration UI, so this adds no extra polling.
  const { data: transferJob } = useAgentTransferJob({ agentId });

  return (
    <div {...stylex.props(headerStyles.container)}>
      <NavHeader
        left={
          <Flexbox
            allowShrink
            horizontal
            align={'center'}
            className={stylex.props(headerStyles.leftContent).className}
            gap={4}
          >
            {splitView && agentMeta && (
              <AgentAvatar
                agentId={agentId}
                alt={agentMeta.title}
                avatar={agentMeta.avatar}
                background={agentMeta.backgroundColor}
                name={agentMeta.title}
                shape={'square'}
                size={24}
                style={{ flex: 'none', marginInlineStart: 8 }}
                title={agentMeta.title}
              />
            )}
            <Tags />
            <HeaderActions />
          </Flexbox>
        }
        right={
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(headerStyles.rightContent).className}
            gap={4}
          >
            {transferJob && agentId && (
              <div {...stylex.props(headerStyles.migrationChipInline)}>
                <AgentMigrationBadge agentId={agentId} />
              </div>
            )}
            {isLocalSystemEnabled && workingDirectory && (
              <OpenInAppButton workingDirectory={workingDirectory} />
            )}
            <TerminalPanelToggle />
            <TopicCommentButton />
            <ShareButton />
            <WorkingPanelToggle />
          </Flexbox>
        }
        slotClassNames={{
          left: stylex.props(headerStyles.slotLeft).className,
          right: stylex.props(headerStyles.slotRight).className,
        }}
      />
      {transferJob && agentId && (
        <div {...stylex.props(headerStyles.migrationChipOverlay)}>
          <AgentMigrationBadge agentId={agentId} />
        </div>
      )}
    </div>
  );
});

export default Header;
