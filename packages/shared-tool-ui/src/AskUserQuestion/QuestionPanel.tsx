'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
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
  /** The picked option id(s), falling back to labels for legacy options. */
  answer: string | string[] | undefined;
  /** Placeholder for the trailing "write your own" free-text row. */
  customPlaceholder: string;
  /** The free-text "write your own" value for this question. */
  customValue: string;
  disabled: boolean;
  /** 0-based keyboard cursor over the option rows (↑/↓ navigation), if any. */
  highlightedIndex?: number;
  /** Tag shown next to the header when the question is multi-select. */
  multiSelectTag: string;
  onCustomChange: (q: AskUserQuestionItem, value: string) => void;
  /**
   * Arrow-key hand-off from the free-text row back into the option list:
   * `prev` fires on ↑ at the very start of the text, `next` on ↓ with the box
   * empty — anywhere else the arrows keep their native caret behavior.
   */
  onCustomNavigate?: (direction: 'next' | 'prev') => void;
  /**
   * Submit the whole form from the free-text box on Enter (Shift+Enter still
   * inserts a newline). Pass `undefined` while submit is unavailable so Enter
   * falls back to the default newline behavior.
   */
  onPressEnter?: () => void;
  onToggle: (q: AskUserQuestionItem, value: string) => void;
  question: AskUserQuestionItem;
  /** Badge text for options carrying the "(Recommended)" label marker. */
  recommendedTag: string;
}

/**
 * A single question: its header/title, the numbered options, and a trailing
 * free-text box so the user can answer in their own words instead of picking.
 *
 * Presentational and i18n-free — the visible strings come in as props so the
 * panel stays app-decoupled and reusable across surfaces.
 */
export const QuestionPanel = memo<QuestionPanelProps>(
  ({
    question,
    answer,
    customValue,
    customPlaceholder,
    disabled,
    highlightedIndex,
    multiSelectTag,
    onToggle,
    onCustomChange,
    onCustomNavigate,
    onPressEnter,
    recommendedTag,
  }) => {
    const isOptionSelected = (value: string): boolean =>
      question.multiSelect ? Array.isArray(answer) && answer.includes(value) : answer === value;

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
          {question.options.map((opt, optIdx) => {
            const value = opt.id ?? opt.label;
            return (
              <OptionCard
                description={opt.description}
                disabled={disabled}
                highlighted={highlightedIndex === optIdx}
                index={optIdx + 1}
                key={value}
                label={opt.label}
                recommendedText={opt.recommended ? recommendedTag : undefined}
                selected={isOptionSelected(value)}
                onToggle={() => onToggle(question, value)}
              />
            );
          })}
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
              onKeyDown={(e) => {
                // The IME guard keeps CJK composition confirms from acting.
                if (e.nativeEvent.isComposing) return;
                if (e.metaKey || e.ctrlKey || e.altKey) return;
                const el = e.currentTarget;
                if (e.key === 'ArrowUp' && onCustomNavigate) {
                  if (el.selectionStart === 0 && el.selectionEnd === 0) {
                    e.preventDefault();
                    el.blur();
                    onCustomNavigate('prev');
                  }
                  return;
                }
                if (e.key === 'ArrowDown' && onCustomNavigate) {
                  if (!el.value) {
                    e.preventDefault();
                    el.blur();
                    onCustomNavigate('next');
                  }
                  return;
                }
                if (e.key !== 'Enter' || e.shiftKey) return;
                if (!onPressEnter) return;
                e.preventDefault();
                onPressEnter();
              }}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

QuestionPanel.displayName = 'AskUserQuestionPanel';

export default QuestionPanel;
