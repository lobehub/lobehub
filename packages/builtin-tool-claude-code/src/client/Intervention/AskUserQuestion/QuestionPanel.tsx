'use client';

import { Flexbox, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AskUserQuestionItem } from '../../../types';
import OptionCard from './OptionCard';

const styles = createStaticStyles(({ css }) => ({
  // Per-question "write your own" input — sits as the last row in the option
  // stack so it reads as one more choice rather than a separate control.
  customInput: css`
    margin-block-start: 2px;
  `,
}));

interface QuestionPanelProps {
  /** The picked option label(s) for this question, if any. */
  answer: string | string[] | undefined;
  /** The free-text "write your own" value for this question. */
  customValue: string;
  disabled: boolean;
  onCustomChange: (q: AskUserQuestionItem, value: string) => void;
  onToggle: (q: AskUserQuestionItem, label: string) => void;
  question: AskUserQuestionItem;
}

/**
 * A single question: its header/title, the numbered options, and a trailing
 * free-text box so the user can answer in their own words instead of picking.
 */
const QuestionPanel = memo<QuestionPanelProps>(
  ({ question, answer, customValue, disabled, onToggle, onCustomChange }) => {
    const { t } = useTranslation('tool');
    const isOptionSelected = (label: string): boolean =>
      question.multiSelect ? Array.isArray(answer) && answer.includes(label) : answer === label;

    return (
      <Flexbox gap={10}>
        <Flexbox horizontal align="center" gap={8}>
          {question.header && <Text type="secondary">{question.header}</Text>}
          {question.multiSelect && (
            <Text fontSize={12} type="secondary">
              {t('claudeCode.askUserQuestion.multiSelectTag')}
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
          {/* Last item: let the user write their own answer for this question. */}
          <TextArea
            autoSize={{ maxRows: 4, minRows: 1 }}
            className={styles.customInput}
            disabled={disabled}
            placeholder={t('claudeCode.askUserQuestion.customOption.placeholder')}
            value={customValue}
            variant="filled"
            onChange={(e) => onCustomChange(question, e.target.value)}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

QuestionPanel.displayName = 'CCAskUserQuestionPanel';

export default QuestionPanel;
