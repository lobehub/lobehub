'use client';

import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

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

const headerStyles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;

    container-name: agent-conv-header;
    container-type: inline-size;

    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};

    ${FLOATING_HEADER_QUERY} {
      pointer-events: none;

      position: absolute;
      z-index: 10;
      inset-block-start: 0;
      inset-inline: 0;

      border-block-end: none;

      background: transparent;
    }
  `,
  leftContent: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;
    background: ${cssVar.colorBgContainer};

    ${FLOATING_HEADER_QUERY} {
      flex-grow: 0;
      border-radius: ${cssVar.borderRadius};
    }
  `,
  rightContent: css`
    background: ${cssVar.colorBgContainer};

    ${FLOATING_HEADER_QUERY} {
      border-radius: ${cssVar.borderRadius};
    }
  `,
  slotLeft: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;

    ${FLOATING_HEADER_QUERY} {
      pointer-events: auto;
      overflow: visible;

      /* Hug the title pill so the transparent middle stays click-through;
         kept narrow so the floating pill covers less of the stream below */
      flex-grow: 0;
      max-width: 220px;
    }
  `,
  // Migration chip, narrow/solid mode: in-flow at the head of the right-hand
  // action group, so it reads as a status alongside the actions and can never
  // collide with the (uncapped) title. Hidden once the header switches to
  // floating mode (the centered overlay takes over).
  migrationChipInline: css`
    flex-shrink: 0;

    ${FLOATING_HEADER_QUERY} {
      display: none;
    }
  `,
  // Migration chip, wide/floating mode: centered against the whole header row
  // (not the leftover space between slots, which skews with title width). The
  // wrapper is click-through; the chip re-enables its own pointer events.
  // Collisions can't happen here — the floating title pill is capped narrow.
  migrationChipOverlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 11;
    inset-block-start: 0;
    inset-inline: 0;

    display: none;
    align-items: center;
    justify-content: center;

    height: 44px;

    ${FLOATING_HEADER_QUERY} {
      display: flex;
    }
  `,
  slotRight: css`
    flex: 0 0 auto;
    min-width: 0;

    ${FLOATING_HEADER_QUERY} {
      pointer-events: auto;
    }
  `,
}));

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
    <div className={headerStyles.container}>
      <NavHeader
        left={
          <Flexbox
            allowShrink
            horizontal
            align={'center'}
            className={headerStyles.leftContent}
            gap={4}
          >
            {splitView && agentMeta && (
              <Avatar
                alt={agentMeta.title}
                avatar={agentMeta.avatar}
                background={agentMeta.backgroundColor}
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
          <Flexbox horizontal align={'center'} className={headerStyles.rightContent} gap={4}>
            {transferJob && agentId && (
              <div className={headerStyles.migrationChipInline}>
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
          left: headerStyles.slotLeft,
          right: headerStyles.slotRight,
        }}
      />
      {transferJob && agentId && (
        <div className={headerStyles.migrationChipOverlay}>
          <AgentMigrationBadge agentId={agentId} />
        </div>
      )}
    </div>
  );
});

export default Header;
