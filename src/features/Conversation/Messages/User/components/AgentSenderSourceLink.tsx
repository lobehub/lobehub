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

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

interface AgentSenderSourceLinkProps {
  /** Sending agent whose topic this turn was launched from. */
  agentId: string;
  /** The source topic id. */
  topicId: string;
}

/**
 * Jump-back to the topic an agent → agent turn was launched from. Sits right
 * after the sending agent's name so the authorship and its origin read as one
 * cluster rather than two facts the reader has to reconcile.
 */
const AgentSenderSourceLink = memo<AgentSenderSourceLinkProps>(({ agentId, topicId }) => {
  const { t } = useTranslation('chat');

  return (
    <Link className={styles.link} href={AGENT_CHAT_TOPIC_URL(agentId, topicId)}>
      <Icon icon={Link2} size={12} />
      {t('agentSender.sourceTopic')}
    </Link>
  );
});

AgentSenderSourceLink.displayName = 'AgentSenderSourceLink';

export default AgentSenderSourceLink;
