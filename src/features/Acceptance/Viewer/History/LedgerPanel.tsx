'use client';

import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileClock, PanelRightClose } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import RoundCard from './RoundCard';
import type { AcceptanceRound, RoundCardModel } from './roundState';

const styles = stylex.create({
  title: { fontSize: '14px', fontWeight: 600, lineHeight: '22px', color: cssVar.colorText },
  count: {
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
  },
});

interface LedgerPanelProps {
  cards: RoundCardModel[];
  footer?: ReactNode;
  /** The hosting surface already provides a close affordance (narrow-mode
      Drawer) — a second collapse icon here would read as two closes. */
  hideCollapse?: boolean;
  highlight: number | null;
  onCollapse: () => void;
  onOpenReport: (round: AcceptanceRound) => void;
}

const LedgerPanel = memo<LedgerPanelProps>(
  ({ cards, footer, hideCollapse, highlight, onCollapse, onOpenReport }) => {
    const { t } = useTranslation('verify');

    return (
      <Flexbox gap={12} padding={16}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorTextSecondary} icon={FileClock} size={16} />
          <span {...stylex.props(styles.title)}>{t('acceptance.ledger.title')}</span>
          <span {...stylex.props(styles.count)}>{cards.length}</span>
          <Flexbox flex={1} />
          {!hideCollapse && (
            <ActionIcon
              icon={PanelRightClose}
              size={'small'}
              title={t('acceptance.ledger.collapse')}
              onClick={onCollapse}
            />
          )}
        </Flexbox>
        {cards.map((card) => (
          <RoundCard
            active={highlight !== null && highlight === card.round.run.roundIndex}
            card={card}
            key={card.round.run.id}
            onOpen={onOpenReport}
          />
        ))}
        {footer}
      </Flexbox>
    );
  },
);

LedgerPanel.displayName = 'AcceptanceLedgerPanel';

export default LedgerPanel;
