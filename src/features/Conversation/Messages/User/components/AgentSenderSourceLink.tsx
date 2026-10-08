'use client';

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Link2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Link from '@/libs/router/Link';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    display: inline-flex;
    flex: none;
    gap: 3px;
    align-items: center;

    max-inline-size: 220px;

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
  /** Sending agent whose topic this turn was launched from. */
  agentId: string;
  /** The source topic id. */
  topicId: string;
  /**
   * The source topic's own name. Shown as the link label; the generic caption is
   * only the fallback for a topic that has none.
   */
  topicTitle?: string | null;
}

/**
 * Jump-back to the topic an agent → agent turn was launched from. Sits after the
 * sending agent's name so the authorship and its origin read as one cluster.
 *
 * Labels itself with the topic's OWN name rather than a generic "source topic"
 * caption: the name is what tells a reader *which* conversation this came from,
 * and repeating a caption on every such message is chrome. The caption stays as
 * the hover title — and as the label for an untitled topic — so the affordance
 * still explains itself.
 */
const AgentSenderSourceLink = memo<AgentSenderSourceLinkProps>(
  ({ agentId, topicId, topicTitle }) => {
    const { t } = useTranslation('chat');
    const caption = t('agentSender.sourceTopic');

    return (
      <Link className={styles.link} href={AGENT_CHAT_TOPIC_URL(agentId, topicId)} title={caption}>
        <Icon icon={Link2} size={12} />
        <span className={styles.label}>{topicTitle || caption}</span>
      </Link>
    );
  },
);

AgentSenderSourceLink.displayName = 'AgentSenderSourceLink';

export default AgentSenderSourceLink;
