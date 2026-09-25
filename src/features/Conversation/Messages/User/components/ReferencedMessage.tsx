import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Reply } from 'lucide-react';
import { memo } from 'react';

import type { ReferencedMessage as ReferencedMessageData } from '@/store/chat/utils/parseReferencedMessage';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;

    padding-block: 6px;
    padding-inline: 10px;
    border-inline-start: 3px solid ${cssVar.colorBorder};
    border-radius: 6px;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  header: css`
    align-items: center;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  quote: css`
    font-style: italic;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  text: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;

    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
}));

/**
 * The message a bot-channel user replied to, rendered as a quote above their
 * text instead of the raw `<referenced_message>` prompt markup.
 */
const ReferencedMessage = memo<{ reference: ReferencedMessageData }>(({ reference }) => (
  <Flexbox className={styles.container} data-testid="referenced-message" gap={2}>
    <Flexbox horizontal className={styles.header} gap={4}>
      <Reply size={12} />
      <span>{reference.sender}</span>
    </Flexbox>
    {reference.text && <div className={styles.text}>{reference.text}</div>}
    {reference.selectedQuote && <div className={styles.quote}>“{reference.selectedQuote}”</div>}
  </Flexbox>
));

ReferencedMessage.displayName = 'UserMessageReferencedMessage';

export default ReferencedMessage;
