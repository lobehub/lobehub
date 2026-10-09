'use client';

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Link2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    display: inline-flex;

    /* Shrinkable, not fixed: the header is a non-wrapping flex row, so on a
       phone-width viewport the cap below plus the author name and avatar would
       overflow the row — the inner ellipsis can only truncate a link that is
       allowed to shrink past its content. */
    flex: 0 1 auto;
    gap: 3px;
    align-items: center;

    min-inline-size: 0;
    max-inline-size: 320px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  label: css`
    overflow: hidden;
    min-inline-size: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface AgentSenderSourceLinkProps {
  /**
   * The agent that OWNS the source topic — the link's `/agent/<id>/` segment.
   * Not necessarily the sending agent: a heterogeneous `callSubAgent` child runs
   * on its spawner's topic, and only the topic's own agent holds that
   * conversation, so the sender must not become this segment.
   */
  topicAgentId: string;
  /** The source topic id. */
  topicId: string;
  /**
   * The source topic's own name. Shown as the link label; the generic caption is
   * only the fallback for a topic that has none.
   */
  topicTitle?: string | null;
}

/**
 * Jump-back to the topic an agent → agent turn was launched from. Sits before the
 * sending agent's name so the authorship and its origin read as one cluster.
 *
 * Labels itself with the topic's OWN name rather than a generic "source topic"
 * caption: the name is what tells a reader *which* conversation this came from,
 * and repeating a caption on every such message is chrome. The caption appears
 * on hover — and is the label for an untitled topic — so the affordance still
 * explains itself without occupying the row.
 */
const AgentSenderSourceLink = memo<AgentSenderSourceLinkProps>(
  ({ topicAgentId, topicId, topicTitle }) => {
    const { t } = useTranslation('chat');
    const caption = t('agentSender.sourceTopic');
    const name = topicTitle?.trim();

    return (
      <Tooltip title={caption}>
        {/* `WorkspaceLink`, not the bare router `Link`: `/agent/...` is mirrored
            under `/:workspaceSlug`, so an unprefixed href would drop a workspace
            reader into their personal route and the source topic would not load. */}
        <WorkspaceLink className={styles.link} to={AGENT_CHAT_TOPIC_URL(topicAgentId, topicId)}>
          <Icon icon={Link2} size={12} />
          <span className={styles.label}>{name || caption}</span>
        </WorkspaceLink>
      </Tooltip>
    );
  },
);

AgentSenderSourceLink.displayName = 'AgentSenderSourceLink';

export default AgentSenderSourceLink;
