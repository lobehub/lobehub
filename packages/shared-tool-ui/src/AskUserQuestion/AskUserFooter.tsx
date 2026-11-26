'use client';

import { Button, Flexbox, Hotkey, Icon, KeyMapEnum, Text } from '@lobehub/ui';
import { ArrowRight, PenLine, Send, X } from 'lucide-react';
import { memo } from 'react';

import type { AskUserPrimaryAction } from './draft';
import type { AskUserQuestionItem } from './types';

export interface AskUserFooterLabels {
  addNote: string;
  next: (title: string) => string;
  removeNote: string;
  sendNoteOnly: string;
  skip: string;
  submit: string;
}

interface AskUserFooterProps {
  countdownText?: string;
  hasDraft: boolean;
  labels: AskUserFooterLabels;
  noteOpen: boolean;
  onAddNote: () => void;
  onPrimary: () => void;
  onRemoveNote: () => void;
  onSkip: () => void;
  primary: { action: AskUserPrimaryAction; enabled: boolean };
  primaryDisabled: boolean;
  questions: AskUserQuestionItem[];
  submitting: boolean;
}

const questionTitle = (questions: AskUserQuestionItem[], index: number) =>
  questions[index]?.header || `Q${index + 1}`;

const primaryLabel = (
  action: AskUserPrimaryAction,
  labels: AskUserFooterLabels,
  questions: AskUserQuestionItem[],
) => {
  switch (action.kind) {
    case 'next': {
      return labels.next(questionTitle(questions, action.index));
    }
    case 'sendNote': {
      return labels.sendNoteOnly;
    }
    case 'submit': {
      return labels.submit;
    }
  }
};

export const AskUserFooter = memo<AskUserFooterProps>(
  ({
    countdownText,
    hasDraft,
    labels,
    noteOpen,
    onAddNote,
    onPrimary,
    onRemoveNote,
    onSkip,
    primary,
    primaryDisabled,
    questions,
    submitting,
  }) => {
    const { action } = primary;

    return (
      <Flexbox horizontal align="center" gap={8} justify="space-between" width={'100%'}>
        <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
          <Button
            disabled={submitting}
            icon={<Icon icon={PenLine} />}
            type="text"
            onClick={noteOpen ? onRemoveNote : onAddNote}
          >
            {noteOpen ? labels.removeNote : labels.addNote}
          </Button>
          {countdownText && (
            <Text ellipsis fontSize={12} type="secondary">
              {countdownText}
            </Text>
          )}
        </Flexbox>
        <Flexbox horizontal gap={8}>
          {/* A host whose question has no "not now" answer (a decision gate)
              passes no skip label, and the form offers no way around it. */}
          {labels.skip && (
            <Button disabled={submitting} icon={<Icon icon={X} />} onClick={onSkip}>
              {labels.skip}
              {!hasDraft && <Hotkey compact keys={KeyMapEnum.Esc} variant="borderless" />}
            </Button>
          )}
          <Button
            disabled={primaryDisabled}
            icon={<Icon icon={action.kind === 'next' ? ArrowRight : Send} />}
            loading={submitting}
            type="primary"
            onClick={onPrimary}
          >
            {primaryLabel(action, labels, questions)}
            <Hotkey compact inverseTheme keys={KeyMapEnum.Enter} variant="borderless" />
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

AskUserFooter.displayName = 'AskUserFooter';

export default AskUserFooter;
