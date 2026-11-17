'use client';

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CornerLeftUp } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const styles = stylex.create({
  link: {
    alignItems: 'center',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    borderRadius: '6px',
    borderStyle: 'none',
    borderWidth: 0,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    cursor: 'pointer',
    display: 'inline-flex',
    flexShrink: 1,
    font: 'inherit',
    fontSize: '12px',
    gap: '4px',
    minWidth: 0,
    paddingBlock: '2px',
    paddingInline: '6px',
  },
  text: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

/**
 * In a sub-session's header: "Opened by X's “…”", back to the conversation
 * that opened it. A sub-session of another agent opens on its own agent's
 * route, where the opener is not in the sidebar — this is the way back.
 */
const OpenedByLink = memo<{ topicId?: string | null }>(({ topicId }) => {
  const { t } = useTranslation('topic');
  const navigate = useWorkspaceAwareNavigate();
  const enabled = useUserStore(labPreferSelectors.enableBetterCodingExperience);
  const openedBy = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata?.openedBy : undefined,
  );
  const openerId = enabled && openedBy && !openedBy.detachedAt ? openedBy.topicId : undefined;

  const useFetchTopicDetail = useChatStore((s) => s.useFetchTopicDetail);
  useFetchTopicDetail(openerId);
  const openerTitle = useChatStore((s) =>
    openerId ? topicSelectors.getTopicById(openerId)(s)?.title : undefined,
  );
  const openerAgentName = useAgentStore((s) => {
    if (!openedBy?.agentId) return undefined;
    const meta = agentSelectors.getAgentMetaById(openedBy.agentId)(s);
    return meta?.title || undefined;
  });

  if (!openerId || !openedBy?.agentId) return null;
  const label = t('subSession.openedBy', {
    agent: openerAgentName || t('subSession.anotherAgent'),
    title: openerTitle || t('subSession.untitledConversation'),
  });

  return (
    <Tooltip title={t('subSession.backToOpener')}>
      <button
        data-testid="sub-session-opened-by"
        type={'button'}
        onClick={() => navigate(AGENT_CHAT_TOPIC_URL(openedBy.agentId!, openerId))}
        {...stylex.props(styles.link)}
      >
        <Icon icon={CornerLeftUp} size={12} />
        <span {...stylex.props(styles.text)}>{label}</span>
      </button>
    </Tooltip>
  );
});

OpenedByLink.displayName = 'OpenedByLink';

export default OpenedByLink;
