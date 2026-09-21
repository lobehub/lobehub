'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { canViewAcceptanceHistory } from '../visibility';

const styles = createStaticStyles(({ css }) => ({
  link: css`
    cursor: pointer;

    padding: 0;
    border: 0;

    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};

    background: none;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }

    @media (width <= 767px) {
      min-height: 44px;
    }
  `,
}));

const AcceptanceViewReportLink = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId, embedded } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const [, setSearchParams] = useSearchParams();
  if (embedded || !data?.latestReport || !canViewAcceptanceHistory(data.isOwner)) return null;

  const round = [...data.rounds].reverse().find((item) => item.report);

  return (
    <button
      className={styles.link}
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
