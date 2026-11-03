import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import ChatInputCredits from '@/business/client/features/ChatInputCredits';
import { SkeletonBar } from '@/components/Skeleton';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import ContextWindow from '../ActionBar/Token';
import { useAgentId } from '../hooks/useAgentId';
import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { useEffectiveAgentMode } from '../hooks/useEffectiveAgentMode';
import { useChatInputStore } from '../store';
import ApprovalMode from './ApprovalMode';
import ModeSelector from './ModeSelector';
import { resolveControlBarView } from './resolveControlBarView';
import WorkspaceControls from './WorkspaceControls';

const styles = stylex.create({
  // `flex: none` keeps the row at 28px inside the column-flex composer; without
  // it the bar shrinks to the compact chips' min-content height.
  bar: { flex: 'none', height: '28px', paddingBlock: '0', paddingInline: '4px' },
  // Left cluster (mode + device + working directory + git) is the variable-width
  // part. It shrinks first and, once its long labels have truncated as far as
  // they can, scrolls horizontally instead of wrapping each chip's text. The
  // scrollbar is hidden — trackpad / wheel still works.
  leftGroup: {
    'scrollbarWidth': 'none',
    'overflowX': 'auto',
    'overflowY': 'hidden',
    'flex': '1',
    'minWidth': '0',
    '::-webkit-scrollbar': { display: 'none' },
  },
  // Right cluster (approval mode + context window) stays pinned and intact.
  rightGroup: { flex: 'none' },
});

interface ControlBarSkeletonProps {
  /** Mirror the right-pinned context-window pill only when the loaded bar renders it. */
  showContextWindow?: boolean;
}

/**
 * Same-height stand-in for the control bar: the 28px row with the mode pill on the
 * left and, when configured, the context-window pill pinned right. Pill sizes follow
 * the settled DOM (mode button ~70x23, context-window tag ~89x24), so the composer
 * does not move when the real controls replace it.
 */
export const ControlBarSkeleton = ({ showContextWindow }: ControlBarSkeletonProps) => (
  <Flexbox
    aria-busy
    horizontal
    align={'center'}
    className={stylex.props(styles.bar).className}
    justify={'space-between'}
  >
    <SkeletonBar height={22} radius={4} width={68} />
    {showContextWindow && <SkeletonBar height={22} radius={4} width={88} />}
  </Flexbox>
);

const ControlBar = memo(() => {
  const agentId = useAgentId();
  const { canShowControls, isAccessLoading } = useChatInputResourceAccess();
  const showContextWindow = useChatInputStore((s) =>
    s.rightActions.flat().includes('contextWindow'),
  );

  const isLoading = useAgentStore((s) => agentByIdSelectors.isAgentConfigLoadingById(agentId)(s));
  const { isAgentRuntimeMode, isPreferenceLoading } = useEffectiveAgentMode(agentId);

  const view = resolveControlBarView({
    agentId,
    canShowControls,
    isAccessLoading,
    isAgentConfigLoading: isLoading,
    isPreferenceLoading,
  });

  if (view === 'hidden') return null;
  if (view === 'skeleton') return <ControlBarSkeleton showContextWindow={showContextWindow} />;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.bar).className}
      justify={'space-between'}
    >
      {/* Left: chat-mode switcher + (agent-only) execution device + working directory */}
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.leftGroup).className}
        gap={4}
      >
        <ModeSelector />
        {isAgentRuntimeMode && <WorkspaceControls agentId={agentId} />}
      </Flexbox>

      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.rightGroup).className}
        gap={4}
      >
        <ChatInputCredits />
        {isAgentRuntimeMode && <ApprovalMode />}
        {showContextWindow && <ContextWindow />}
      </Flexbox>
    </Flexbox>
  );
});

ControlBar.displayName = 'ControlBar';

export default ControlBar;
