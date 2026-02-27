'use client';

import { Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Brain, ChartBar, Clock, MessageSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const useStyles = createStyles(({ css, token }) => ({
  center: css`
    position: absolute;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    margin: auto;
    border-radius: 50%;

    color: ${token.colorWarning};

    background: ${token.colorWarningBg};
  `,
  container: css`
    position: relative;

    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    height: 320px;
  `,
  hint: css`
    margin-block-start: 24px;
    font-size: 13px;
    color: ${token.colorTextQuaternary};
  `,
  icon: css`
    position: absolute;
    transform: translate(-50%, -50%);

    display: flex;
    align-items: center;
    justify-content: center;

    width: 30px;
    height: 30px;
    border-radius: 8px;
  `,
  icon1: css`
    inset-block-start: 15px;
    inset-inline-start: 100px;
    color: ${token.geekblue};
    background: ${token.geekblue1};
  `,
  icon2: css`
    inset-block-start: 143px;
    inset-inline-start: 174px;
    color: ${token.colorSuccess};
    background: ${token.colorSuccessBg};
  `,
  icon3: css`
    inset-block-start: 143px;
    inset-inline-start: 26px;
    color: ${token.purple};
    background: ${token.purple1};
  `,
  orbit: css`
    position: absolute;
    inset: 0;

    margin: auto;
    border: 1px dashed ${token.colorBorderSecondary};
    border-radius: 50%;
  `,
  orbit1: css`
    width: 200px;
    height: 200px;
  `,
  orbit2: css`
    width: 140px;
    height: 140px;
  `,
  orbit3: css`
    width: 80px;
    height: 80px;
  `,
  orbitGroup: css`
    position: relative;
    width: 200px;
    height: 200px;
  `,
}));

const PendingState = memo(() => {
  const { t } = useTranslation('eval');
  const { cx, styles } = useStyles();

  return (
    <div className={styles.container}>
      <div className={styles.orbitGroup}>
        <div className={cx(styles.orbit, styles.orbit1)} />
        <div className={cx(styles.orbit, styles.orbit2)} />
        <div className={cx(styles.orbit, styles.orbit3)} />
        <div className={cx(styles.icon, styles.icon1)}>
          <Icon icon={Brain} size={16} />
        </div>
        <div className={cx(styles.icon, styles.icon2)}>
          <Icon icon={MessageSquare} size={16} />
        </div>
        <div className={cx(styles.icon, styles.icon3)}>
          <Icon icon={ChartBar} size={16} />
        </div>
        <div className={styles.center}>
          <Icon icon={Clock} size={18} />
        </div>
      </div>
      <div className={styles.hint}>{t('run.pending.hint')}</div>
    </div>
  );
});

export default PendingState;
