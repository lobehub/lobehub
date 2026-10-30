'use client';

import {
  BOT_WAKE_USER_LABELS_BY_OUTCOME,
  type BotWakeUserLabel,
  type SignalDecisionOutcome,
} from '@lobechat/types';
import { Button, Flexbox, toast } from '@lobehub/ui';
import { BellRing, Check, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const ICONS: Record<BotWakeUserLabel, typeof Check> = {
  correct: Check,
  false_wake: X,
  missed_wake: BellRing,
};

interface MarkButtonsProps {
  current?: BotWakeUserLabel;
  disabled?: boolean;
  /** `null` takes the current mark back. */
  onMark: (label: BotWakeUserLabel | null) => Promise<void>;
  outcome: SignalDecisionOutcome;
}

/**
 * Whether the bot judged this message right, one click. The current mark stays highlighted;
 * clicking it again takes it back, clicking another switches to that one.
 */
export const MarkButtons = ({ current, disabled, onMark, outcome }: MarkButtonsProps) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const [pending, setPending] = useState<BotWakeUserLabel>();
  const choices = BOT_WAKE_USER_LABELS_BY_OUTCOME[outcome] ?? [];

  const mark = async (label: BotWakeUserLabel) => {
    if (pending) return;
    setPending(label);
    try {
      await onMark(label === current ? null : label);
    } catch {
      toast.error(t('channel.records.mark.failed'));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Flexbox horizontal gap={6} wrap={'wrap'}>
      {choices.map((label) => {
        const Icon = ICONS[label];
        const active = current === label;

        return (
          <Button
            aria-pressed={active}
            disabled={disabled || (!!pending && pending !== label)}
            icon={<Icon size={14} />}
            key={label}
            loading={pending === label}
            size={'small'}
            title={active ? t('channel.records.mark.undo') : undefined}
            type={active ? 'primary' : 'default'}
            onClick={() => void mark(label)}
          >
            {t(`channel.records.mark.${label}`)}
          </Button>
        );
      })}
    </Flexbox>
  );
};
