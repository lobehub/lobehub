'use client';

import { Flexbox, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { OptionCard } from '../components';
import type { AskUserQuestionItem } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Per-question "write your own" input — sits as the last row in the option
  // stack, carrying the next sequential number so it reads as one more choice
  // rather than a separate control.
  customRow: css`
    margin-block-start: 2px;

    /* Align the chip under the option number chips (OptionCard padding-inline). */
    padding-inline: 12px;
  `,
  // Mirrors OptionCard's `optionIndex` chip so the free-text row's number reads
  // identically to the numbered options above it.
  index: css`
    flex-shrink: 0;

    box-sizing: border-box;
    width: 22px;
    height: 22px;
    border-radius: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface QuestionPanelProps {
  /** The picked option label(s) for this question, if any. */
  answer: string | string[] | undefined;
  /** Placeholder for the trailing "write your own" free-text row. */
  customPlaceholder: string;
  /** The free-text "write your own" value for this question. */
  customValue: string;
  disabled: boolean;
  /** Tag shown next to the header when the question is multi-select. */
  multiSelectTag: string;
  onCustomChange: (q: AskUserQuestionItem, value: string) => void;
  onToggle: (q: AskUserQuestionItem, label: string) => void;
  question: AskUserQuestionItem;
}

/**
 * A single question: its header/title, the numbered options, and a trailing
 * free-text box so the user can answer in their own words instead of picking.
 *
 * Presentational and i18n-free — the two visible strings come in as props so
 * the panel stays app-decoupled and reusable across surfaces.
 */
export const QuestionPanel = memo<QuestionPanelProps>(
  ({
    question,
    answer,
    customValue,
    customPlaceholder,
    disabled,
    multiSelectTag,
    onToggle,
    onCustomChange,
  }) => {
    const isOptionSelected = (label: string): boolean =>
      question.multiSelect ? Array.isArray(answer) && answer.includes(label) : answer === label;

    return (
      <Flexbox gap={10}>
        <Flexbox horizontal align="center" gap={8}>
          {question.header && <Text type="secondary">{question.header}</Text>}
          {question.multiSelect && (
            <Text fontSize={12} type="secondary">
              {multiSelectTag}
            </Text>
          )}
        </Flexbox>
        <Text strong>{question.question}</Text>

        <Flexbox gap={4} role="listbox">
          {question.options.map((opt, optIdx) => (
            <OptionCard
              description={opt.description}
              disabled={disabled}
              index={optIdx + 1}
              key={opt.label}
              label={opt.label}
              selected={isOptionSelected(opt.label)}
              onToggle={() => onToggle(question, opt.label)}
            />
          ))}
          {/* Last item: let the user write their own answer for this question.
              Numbered as the next option so it reads as one more choice. */}
          <Flexbox horizontal align="center" className={styles.customRow} gap={12}>
            <span className={styles.index}>{question.options.length + 1}</span>
            <TextArea
              autoSize={{ maxRows: 4, minRows: 1 }}
              disabled={disabled}
              placeholder={customPlaceholder}
              style={{ flex: 1 }}
              value={customValue}
              variant="filled"
              onChange={(e) => onCustomChange(question, e.target.value)}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

QuestionPanel.displayName = 'AskUserQuestionPanel';

export default QuestionPanel;
