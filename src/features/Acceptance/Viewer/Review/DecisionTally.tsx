import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { decisionBarStyles as styles } from './decisionBarStyles';

interface DecisionTallyProps {
  acceptedCount: number;
  ignoredCount: number;
  needsFixCount: number;
  pendingCount: number;
}

export const DecisionTally = ({
  acceptedCount,
  ignoredCount,
  needsFixCount,
  pendingCount,
}: DecisionTallyProps) => {
  const { t } = useTranslation('verify');

  return (
    <div {...stylex.props(styles.tallyRow)}>
      <span {...stylex.props(styles.tally)}>
        <i {...stylex.props(styles.dot, styles.dotAccepted)} />
        {t('acceptance.bar.tally.accepted', { count: acceptedCount })}
      </span>
      <span {...stylex.props(styles.tally)}>
        <i {...stylex.props(styles.dot, styles.dotNeedsFix)} />
        {t('acceptance.bar.tally.needsFix', { count: needsFixCount })}
      </span>
      {ignoredCount > 0 && (
        <span {...stylex.props(styles.tally)}>
          <i {...stylex.props(styles.dot, styles.dotIgnored)} />
          {t('acceptance.bar.tally.ignored', { count: ignoredCount })}
        </span>
      )}
      <span {...stylex.props(styles.tally)}>
        <i {...stylex.props(styles.dot)} />
        {t('acceptance.bar.tally.pending', { count: pendingCount })}
      </span>
    </div>
  );
};
