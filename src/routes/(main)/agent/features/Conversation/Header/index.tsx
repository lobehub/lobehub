'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import OpenInAppButton from '@/features/OpenInAppButton';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';

import HeaderActions from './HeaderActions';
import ShareButton from './ShareButton';
import Tags from './Tags';
import TerminalToggle from './TerminalToggle';
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
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  rightContent: css`
    background: ${cssVar.colorBgContainer};

    ${FLOATING_HEADER_QUERY} {
      border-radius: ${cssVar.borderRadius};
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  slotLeft: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;

    ${FLOATING_HEADER_QUERY} {
      pointer-events: auto;
      overflow: visible;

      /* Hug the title pill so the transparent middle stays click-through */
      flex-grow: 0;
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
  const agentId = useChatStore((s) => s.activeAgentId);
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const agentWorkingDirectory = useAgentStore((s) =>
    agentId
      ? agentByIdSelectors.getAgentWorkingDirectoryById(agentId, currentDeviceId)(s)
      : undefined,
  );
  const isLocalSystemEnabled = useAgentStore((s) =>
    agentId ? chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(s) : false,
  );
  const effectiveWorkingDirectory = topicWorkingDirectory || agentWorkingDirectory || '';

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
            <Tags />
            <HeaderActions />
          </Flexbox>
        }
        right={
          <Flexbox horizontal align={'center'} className={headerStyles.rightContent} gap={4}>
            {isLocalSystemEnabled && (
              <OpenInAppButton workingDirectory={effectiveWorkingDirectory} />
            )}
            <ShareButton />
            <TerminalToggle />
            <WorkingPanelToggle />
          </Flexbox>
        }
        slotClassNames={{
          left: headerStyles.slotLeft,
          right: headerStyles.slotRight,
        }}
      />
    </div>
  );
});

export default Header;
