'use client';

import { normalizeAskUserQuestions } from '@lobechat/shared-tool-ui/ask-user';
import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AskUserQuestionArgs } from '../../types';
import { ClaudeCodeApiName } from '../../types';

/**
 * A tool card in the message list is ~470px wide, leaving ~210px for the chips.
 * Two headers fit at their natural width; a third forces all of them to shrink and
 * every chip ellipsizes to two characters, which says less than showing fewer. So
 * cap at two and fold the rest into `+N` — fewer, fully legible beats more, truncated.
 */
const MAX_CHIPS = 2;

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;

    min-width: 0;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  chips: css`
    overflow: hidden;
    display: flex;
    gap: 4px;
    align-items: center;

    min-width: 0;
    margin-inline-start: 6px;
  `,
  /** Never shrinks — the chips absorb the compression and ellipsize instead. */
  label: css`
    flex-shrink: 0;
  `,
  more: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

export const AskUserQuestionInspector = memo<BuiltinInspectorProps<AskUserQuestionArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.AskUserQuestion as any);
    const argsQuestions = normalizeAskUserQuestions(args);
    const questions = argsQuestions.length ? argsQuestions : normalizeAskUserQuestions(partialArgs);

    // One chip per question, so a collapsed card still says *what* was asked. The
    // old `header +N` named only the first and turned the rest into a count.
    const headers = questions
      .map((q) => q.header || q.question)
      .filter((header): header is string => !!header);
    const shown = headers.slice(0, MAX_CHIPS);
    const rest = headers.length - shown.length;

    if (isArgumentsStreaming && shown.length === 0) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span className={styles.label}>{label}</span>
        {shown.length > 0 && (
          <div className={styles.chips}>
            {shown.map((header, idx) => (
              <span className={styles.chip} key={`${header}-${idx}`}>
                {header}
              </span>
            ))}
            {rest > 0 && <span className={styles.more}>{`+${rest}`}</span>}
          </div>
        )}
      </div>
    );
  },
);

AskUserQuestionInspector.displayName = 'ClaudeCodeAskUserQuestionInspector';
