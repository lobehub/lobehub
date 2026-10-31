'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  body: {
    overflowY: 'auto',
    maxHeight: '240px',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderRadius: '10px',
    fontSize: cssVar.fontSize,
    lineHeight: 1.75,
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  bodyMuted: {
    overflowY: 'auto',
    maxHeight: '120px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: '10px',
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.7,
    color: cssVar.colorTextTertiary,
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  head: { fontSize: cssVar.fontSizeSM, fontWeight: 500, color: cssVar.colorTextTertiary },
});

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
      <Flexbox horizontal align="center" className={stylex.props(styles.head).className} gap={6}>
        <span>{roleKey ? t(roleKey as any) : role}</span>
        {badge && <Tag size="small">{badge}</Tag>}
      </Flexbox>
      <div {...stylex.props(muted ? styles.bodyMuted : styles.body)}>{content}</div>
    </Flexbox>
  );
});

MessageBlock.displayName = 'MessageBlock';

export default MessageBlock;
