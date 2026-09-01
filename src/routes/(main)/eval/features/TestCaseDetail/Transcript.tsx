'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
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
  chevron: css`
    transition: transform 0.15s ease;
  `,
  chevronOpen: css`
    transform: rotate(90deg);
  `,
  toggle: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;
    align-self: flex-start;

    padding: 0;
    border: none;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

export interface TranscriptProps {
  input: string;
  /** Replaces the input block, so the turn under test can be made editable. */
  inputSlot?: ReactNode;
  /** Conversation replayed into the eval topic before `input` is sent. */
  messages?: TranscriptMessage[];
}

/**
 * The case read as one conversation rather than as separate labelled fields:
 * the replayed context, a boundary, then the turn actually under test.
 *
 * The context is collapsed by default. It is provenance — usually long, rarely
 * what you opened the case to read — and expanded it pushes the turn under test
 * and its criteria below the fold.
 */
const Transcript = memo<TranscriptProps>(({ input, inputSlot, messages }) => {
  const { t } = useTranslation('eval');
  const { context, hasBoundary } = buildTranscript(messages);
  const [expanded, setExpanded] = useState(false);

  return (
    <Flexbox gap={12}>
      {hasBoundary && (
        <button className={styles.toggle} type="button" onClick={() => setExpanded((v) => !v)}>
          <Icon
            className={expanded ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron}
            icon={ChevronRight}
            size={14}
          />
          {t('testCaseDetail.context', { count: context.length })}
        </button>
      )}
      {expanded && (
        <>
          {context.map((turn, index) => (
            <MessageBlock muted content={turn.text} key={index} role={turn.role} />
          ))}
          <div className={styles.boundary}>{t('testCaseDetail.boundary')}</div>
        </>
      )}
      {inputSlot ?? <MessageBlock badge="input" content={input} role="user" />}
    </Flexbox>
  );
});

Transcript.displayName = 'Transcript';

export default Transcript;
