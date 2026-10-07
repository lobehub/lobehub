'use client';

import { type EvalReplayToolCall } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Wrench } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ClampText from './ClampText';

const styles = createStaticStyles(({ css }) => ({
  call: css`
    padding-block: 6px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  callName: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  args: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    line-height: ${cssVar.lineHeightSM};
    color: ${cssVar.colorTextSecondary};
  `,
  note: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  text: css`
    font-size: ${cssVar.fontSize};
    line-height: ${cssVar.lineHeight};
    color: ${cssVar.colorText};
  `,
}));

interface CellAnswerProps {
  content?: string | null;
  /** Lines of text shown before "Show more". */
  lines?: number;
  toolCalls?: EvalReplayToolCall[] | null;
}

/**
 * What a model answered: its text, and any tool calls it made instead of (or
 * besides) text — a tool-call-only answer is still an answer, not a blank.
 */
const CellAnswer = memo<CellAnswerProps>(({ content, lines = 3, toolCalls }) => {
  const { t } = useTranslation('eval');
  const calls = toolCalls ?? [];

  return (
    <Flexbox gap={8}>
      {content ? (
        <ClampText className={styles.text} lines={lines}>
          {content}
        </ClampText>
      ) : (
        calls.length > 0 && <span className={styles.note}>{t('comparison.cell.noText')}</span>
      )}
      {calls.map((call, i) => (
        <Flexbox className={styles.call} gap={4} key={i}>
          <Flexbox horizontal align="center" gap={6}>
            <Icon color={cssVar.colorTextTertiary} icon={Wrench} size={12} />
            <span className={styles.callName}>{call.name}</span>
          </Flexbox>
          {call.arguments && (
            <ClampText className={styles.args} lines={2}>
              {call.arguments}
            </ClampText>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
});

CellAnswer.displayName = 'EvalComparisonCellAnswer';

export default CellAnswer;
