'use client';

import { Flexbox } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;

    /* Each turn is capped so a long one cannot push the rest of the
       transcript out of view; the full text stays reachable inside. */
    max-height: 240px;
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: 10px;

    font-size: ${cssVar.fontSize};
    line-height: 1.75;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  bodyMuted: css`
    overflow-y: auto;

    max-height: 120px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 10px;

    font-size: ${cssVar.fontSizeSM};
    line-height: 1.7;
    color: ${cssVar.colorTextTertiary};
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  head: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
}));

export interface MessageBlockProps {
  badge?: string;
  content: string;
  /** Context turns are dimmed so the eye lands on the turn under test. */
  muted?: boolean;
  role: string;
}

const ROLE_KEYS: Record<string, string> = {
  assistant: 'testCaseDetail.role.assistant',
  system: 'testCaseDetail.role.system',
  tool: 'testCaseDetail.role.tool',
  user: 'testCaseDetail.role.user',
};

const MessageBlock = memo<MessageBlockProps>(({ badge, content, muted, role }) => {
  const { t } = useTranslation('eval');
  const roleKey = ROLE_KEYS[role];

  return (
    <Flexbox gap={5}>
      <Flexbox horizontal align="center" className={styles.head} gap={6}>
        <span>{roleKey ? t(roleKey as any) : role}</span>
        {badge && <Tag size="small">{badge}</Tag>}
      </Flexbox>
      <div className={muted ? styles.bodyMuted : styles.body}>{content}</div>
    </Flexbox>
  );
});

MessageBlock.displayName = 'MessageBlock';

export default MessageBlock;
