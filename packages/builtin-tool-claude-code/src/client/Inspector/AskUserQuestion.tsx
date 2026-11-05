'use client';

import { normalizeAskUserQuestions } from '@lobechat/shared-tool-ui/ask-user';
import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    minWidth: 0,
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  chips: {
    overflow: 'hidden',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    minWidth: 0,
    marginInlineStart: '6px',
  },
  label: { flexShrink: 0 },
  more: { flexShrink: 0, fontSize: '12px', color: cssVar.colorTextTertiary },
});

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
      <div className={inspectorTextStyles.root}>
        <span
          className={cx(
            stylex.props(styles.label).className,
            (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
          )}
        >
          {label}
        </span>
        {shown.length > 0 && (
          <div {...stylex.props(styles.chips)}>
            {shown.map((header, idx) => (
              <span key={`${header}-${idx}`} {...stylex.props(styles.chip)}>
                {header}
              </span>
            ))}
            {rest > 0 && <span {...stylex.props(styles.more)}>{`+${rest}`}</span>}
          </div>
        )}
      </div>
    );
  },
);

AskUserQuestionInspector.displayName = 'ClaudeCodeAskUserQuestionInspector';
