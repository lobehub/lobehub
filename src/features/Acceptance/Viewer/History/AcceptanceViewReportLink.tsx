'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { canViewAcceptanceHistory } from '../visibility';

const styles = stylex.create({
  link: {
    cursor: 'pointer',
    padding: '0',
    borderStyle: 'none',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorTextSecondary },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    minHeight: { 'default': null, '@media (width <= 767px)': '44px' },
  },
});

const AcceptanceViewReportLink = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const [, setSearchParams] = useSearchParams();
  if (embedded || !data?.latestReport || !canViewAcceptanceHistory(data.isOwner)) return null;

  const round = [...data.rounds].reverse().find((item) => item.report);

  return (
    <button
      {...stylex.props(styles.link)}
      type={'button'}
      onClick={() => {
        if (round?.run.roundIndex == null) return;
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev);
            params.set('report', String(round.run.roundIndex));
            return params;
          },
          { replace: true },
        );
      }}
    >
      {t('acceptance.viewFullReport')}
    </button>
  );
};

export default AcceptanceViewReportLink;
