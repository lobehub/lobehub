import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import type { ScreenCaptureAgentOption } from '@lobechat/electron-client-ipc';

const LOBE_AI_TITLE = 'Lobe AI';
const UNTITLED_AGENT_TITLE = 'Untitled Agent';

interface OverlayAgentSource {
  avatar?: unknown;
  backgroundColor?: string | null;
  id: string;
  title?: string | null;
}

interface OverlayInboxMeta {
  avatar?: string | null;
  backgroundColor?: string | null;
  title?: string | null;
}

interface ResolveOverlayAgentOptionsParams {
  agents: readonly OverlayAgentSource[];
  inboxAgentId?: string;
  inboxMeta?: OverlayInboxMeta;
}

interface ResolveOverlayDefaultAgentIdParams {
  activeAgentId?: string;
  agentOptions: readonly ScreenCaptureAgentOption[];
  inboxAgentId?: string;
}

const toOverlayAgentOption = ({
  avatar,
  backgroundColor,
  id,
  title,
}: OverlayAgentSource): ScreenCaptureAgentOption => ({
  avatar: typeof avatar === 'string' ? avatar : DEFAULT_AVATAR,
  backgroundColor: backgroundColor ?? undefined,
  id,
  title: title?.trim() || UNTITLED_AGENT_TITLE,
});

const createInboxOverlayAgentOption = (
  inboxAgentId: string,
  inboxMeta?: OverlayInboxMeta,
): ScreenCaptureAgentOption => ({
  avatar: inboxMeta?.avatar || DEFAULT_INBOX_AVATAR,
  backgroundColor: inboxMeta?.backgroundColor ?? undefined,
  id: inboxAgentId,
  title: inboxMeta?.title || LOBE_AI_TITLE,
});

export const resolveOverlayAgentOptions = ({
  agents,
  inboxAgentId,
  inboxMeta,
}: ResolveOverlayAgentOptionsParams): ScreenCaptureAgentOption[] => {
  const agentOptions = agents.map((item) => toOverlayAgentOption(item));

  if (!inboxAgentId) return agentOptions;
  if (agentOptions.some((item) => item.id === inboxAgentId)) return agentOptions;

  return [createInboxOverlayAgentOption(inboxAgentId, inboxMeta), ...agentOptions];
};

export const resolveOverlayDefaultAgentId = ({
  activeAgentId,
  agentOptions,
  inboxAgentId,
}: ResolveOverlayDefaultAgentIdParams): string | undefined => {
  if (activeAgentId && agentOptions.some((item) => item.id === activeAgentId)) {
    return activeAgentId;
  }

  if (inboxAgentId && agentOptions.some((item) => item.id === inboxAgentId)) {
    return inboxAgentId;
  }

  return agentOptions[0]?.id;
};
