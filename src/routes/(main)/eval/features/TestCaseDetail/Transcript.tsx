'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildTranscript, type TranscriptMessage } from './buildTranscript';
import MessageBlock from './MessageBlock';

const styles = createStaticStyles(({ css }) => ({
  boundary: css`
    display: flex;
    gap: 8px;
    align-items: center;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextQuaternary};

    &::after {
      content: '';
      flex: 1;
      height: 1px;
      background: ${cssVar.colorSplit};
    }
  `,
}));

export interface TranscriptProps {
  input: string;
  /** Conversation replayed into the eval topic before `input` is sent. */
  messages?: TranscriptMessage[];
}

/**
 * The case read as one conversation rather than as separate labelled fields:
 * the replayed context, a boundary, then the turn actually under test.
 */
const Transcript = memo<TranscriptProps>(({ input, messages }) => {
  const { t } = useTranslation('eval');
  const { context, hasBoundary } = buildTranscript(messages);

  return (
    <Flexbox gap={12}>
      {context.map((turn, index) => (
        <MessageBlock muted content={turn.text} key={index} role={turn.role} />
      ))}
      {hasBoundary && <div className={styles.boundary}>{t('testCaseDetail.boundary')}</div>}
      <MessageBlock badge="input" content={input} role="user" />
    </Flexbox>
  );
});

Transcript.displayName = 'Transcript';

export default Transcript;
