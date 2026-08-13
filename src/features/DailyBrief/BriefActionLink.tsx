'use client';

import { isDesktop } from '@lobechat/const';
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import { Button } from '@lobehub/ui/base-ui';
import type { MouseEvent, ReactNode } from 'react';
import { memo, useCallback } from 'react';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { parseInternalLink } from '@/features/Conversation/Markdown/plugins/Link/internalLink';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

interface BriefActionLinkProps {
  /** Agent owning the brief's task — keeps the task detail path agent-scoped. */
  agentId?: string | null;
  children: ReactNode;
  className?: string;
  /** Renders the filled primary variant used for a card's leading action. */
  primary?: boolean;
  taskId?: string | null;
  url?: string;
}

/**
 * A `type: 'link'` brief action.
 *
 * A bare `<a href>` is a document navigation: on the web it throws away the
 * whole SPA, and in Electron it hands `app://renderer/<path>` to a router that
 * never registered the target (acceptance is web-only — see
 * `desktopRouter.config.tsx`), so the button reads as dead. Internal
 * destinations therefore route through React Router instead, and acceptance —
 * which has no standalone desktop route at all — opens in the task-agent panel
 * beside its task, the same surface `TaskAcceptance` / `RunVerifyTag` use.
 *
 * The `href` stays on the anchor so middle-click / copy-link still work, and
 * `RENDERER_HANDLED_LINK_ATTR` tells the desktop preload interceptor this
 * click is already claimed.
 */
export const BriefActionLink = memo<BriefActionLinkProps>(
  ({ agentId, children, className, primary, taskId, url }) => {
    const navigate = useWorkspaceAwareNavigate();
    const workspaces = useWorkspaces();
    const openAcceptance = useChatStore((s) => s.openAcceptance);
    const toggleTaskAgentPanel = useGlobalStore((s) => s.toggleTaskAgentPanel);

    const reference = parseInternalLink(
      url,
      typeof window === 'undefined' ? undefined : window.location.origin,
      workspaces.map((workspace) => workspace.slug),
    );
    const isTasklessDesktopAcceptance = isDesktop && reference?.type === 'acceptance' && !taskId;
    const isRendererHandled = !!reference && !isTasklessDesktopAcceptance;

    const handleClick = useCallback(
      (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
        // External destinations (billing, docs) stay plain anchors.
        if (!reference) return;
        // Electron has no standalone acceptance route. Without a task there is
        // no panel destination either, so leave the link to the preload layer.
        if (isTasklessDesktopAcceptance) return;
        if (event.button !== 0) return;

        // On the web a modifier-click means "open in a new tab", so let the
        // browser handle it. Desktop has no tabs for it to open.
        const modifierClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
        if (!isDesktop && modifierClick) return;

        event.preventDefault();

        if (reference.type === 'acceptance' && taskId) {
          // Arm the panel before navigating, the same handoff
          // `Home/InputArea/useSend` performs — the panel mounts with the task
          // page and reads this state on its first render.
          toggleTaskAgentPanel(true);
          openAcceptance(reference.acceptanceId);
          navigate(taskDetailPath(taskId, agentId ?? undefined));
          return;
        }

        // A path that already carries its workspace slug must not be prefixed twice.
        navigate(
          reference.pathname,
          'workspaceSlug' in reference && reference.workspaceSlug ? { escape: true } : undefined,
        );
      },
      [
        agentId,
        isTasklessDesktopAcceptance,
        navigate,
        openAcceptance,
        reference,
        taskId,
        toggleTaskAgentPanel,
      ],
    );

    return (
      <Button
        {...(isRendererHandled ? { [RENDERER_HANDLED_LINK_ATTR]: 'true' } : {})}
        className={className}
        href={url}
        shape={'round'}
        type={primary ? 'primary' : 'default'}
        onClick={handleClick}
      >
        {children}
      </Button>
    );
  },
);

BriefActionLink.displayName = 'BriefActionLink';
