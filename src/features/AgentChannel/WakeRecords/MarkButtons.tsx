'use client';

import {
  BOT_WAKE_USER_LABELS_BY_OUTCOME,
  type BotWakeUserLabel,
  type SignalDecisionOutcome,
} from '@lobechat/types';
import { ActionIcon, DropdownMenu, Flexbox, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  right: { color: cssVar.colorSuccess },
  wrong: { color: cssVar.colorError },
});

type WrongLabel = Exclude<BotWakeUserLabel, 'correct'>;

interface MarkButtonsProps {
  current?: BotWakeUserLabel;
  disabled?: boolean;
  /** `null` takes the current mark back. */
  onMark: (label: BotWakeUserLabel | null) => Promise<void>;
  outcome: SignalDecisionOutcome;
}

/**
 * Whether the bot judged this message right: ✓ right, ✗ wrong. A wake that was wrong should not
 * have woken, a skip that was wrong should have; a deferred message can be wrong either way, so its
 * ✗ asks which. The current mark is coloured; clicking it again takes it back.
 */
export const MarkButtons = ({ current, disabled, onMark, outcome }: MarkButtonsProps) => {
  const { t: _t } = useTranslation('agent');
  const t = _t as (key: string) => string;
  const [pending, setPending] = useState(false);
  const wrongChoices = (BOT_WAKE_USER_LABELS_BY_OUTCOME[outcome] ?? []).filter(
    (label): label is WrongLabel => label !== 'correct',
  );
  const wrongCurrent = current && current !== 'correct' ? current : undefined;

  const mark = async (label: BotWakeUserLabel) => {
    if (pending) return;
    setPending(true);
    try {
      await onMark(label === current ? null : label);
    } catch {
      toast.error(t('channel.records.mark.failed'));
    } finally {
      setPending(false);
    }
  };

  const hint = (label: BotWakeUserLabel) =>
    current === label
      ? `${t(`channel.records.mark.${label}`)} · ${t('channel.records.mark.undo')}`
      : t(`channel.records.mark.${label}`);

  const right = (
    <ActionIcon
      active={current === 'correct'}
      aria-label={t('channel.records.mark.correct')}
      aria-pressed={current === 'correct'}
      disabled={disabled || pending}
      icon={Check}
      size={'small'}
      title={hint('correct')}
      onClick={() => void mark('correct')}
      {...(current === 'correct' && stylex.props(styles.right))}
    />
  );

  const wrongIcon = (label: WrongLabel | undefined, onClick?: () => void) => (
    <ActionIcon
      active={!!wrongCurrent}
      aria-label={label ? t(`channel.records.mark.${label}`) : t('channel.records.mark.wrong')}
      aria-pressed={!!wrongCurrent}
      disabled={disabled || pending}
      icon={X}
      size={'small'}
      title={label ? hint(label) : t('channel.records.mark.wrong')}
      onClick={onClick}
      {...(wrongCurrent && stylex.props(styles.wrong))}
    />
  );

  // One way to be wrong (a wake or a skip): ✗ marks it directly.
  // Two ways (a deferred message): ✗ takes back a current wrong mark, or asks which way.
  const wrong =
    wrongChoices.length === 1 ? (
      wrongIcon(wrongChoices[0], () => void mark(wrongChoices[0]))
    ) : wrongCurrent ? (
      wrongIcon(wrongCurrent, () => void mark(wrongCurrent))
    ) : (
      <DropdownMenu
        items={wrongChoices.map((label) => ({
          key: label,
          label: t(`channel.records.mark.${label}`),
          onClick: () => void mark(label),
        }))}
      >
        {wrongIcon(undefined)}
      </DropdownMenu>
    );

  return (
    <Flexbox horizontal gap={4}>
      {right}
      {wrong}
    </Flexbox>
  );
};
