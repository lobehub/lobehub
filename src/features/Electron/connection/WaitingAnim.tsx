'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx, keyframes } from 'antd-style';
import { WifiIcon } from 'lucide-react';
import { memo } from 'react';

const airdropPulse = keyframes`
    0% {
      transform: translate(-50%, -50%) scale(0.8);
      opacity: 0.5;
    }
    100% {
      transform: translate(-50%, -50%) scale(2.5);
      opacity: 0;
    }
`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    position: relative;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 160px;
    height: 160px;
    margin-block-end: ${cssVar.marginXL};
  `,

  pulse1: css`
    animation: ${airdropPulse} 3s ease-out infinite;
  `,

  pulse2: css`
    animation: ${airdropPulse} 3s ease-out 1.2s infinite;
  `,

  pulse3: css`
    animation: ${airdropPulse} 3s ease-out 1.8s infinite;
  `,
  pulseBase: css`
    pointer-events: none;
    content: '';

    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    width: 100px;
    height: 100px;
    border-radius: 50%;

    opacity: 0;
    background-color: ${cssVar.colorPrimaryBgHover};
  `,

  radarIcon: css`
    z-index: 1;
    color: ${cssVar.colorPrimary};
  `,

  ring1: css`
    width: 80px;
    height: 80px;
    border: 1px solid ${cssVar.colorText};
  `,

  ring2: css`
    width: 120px;
    height: 120px;
    border: 1px solid ${cssVar.colorTextQuaternary};
  `,

  ring3: css`
    width: 160px;
    height: 160px;
    border: 1px solid ${cssVar.colorFillSecondary};
  `,

  ringBase: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    transform: translate(-50%, -50%);

    border-radius: 50%;
  `,
}));

const WaitingAnim = memo(() => {
  return (
    <div className={styles.container}>
      {/* 新增：星环 */}
      <div className={cx(styles.ringBase, styles.ring1)} />
      <div className={cx(styles.ringBase, styles.ring2)} />
      <div className={cx(styles.ringBase, styles.ring3)} />
      {/* 脉冲 */}
      <div className={cx(styles.pulseBase, styles.pulse1)} />
      <div className={cx(styles.pulseBase, styles.pulse2)} />
      <div className={cx(styles.pulseBase, styles.pulse3)} />

      <Icon className={styles.radarIcon} icon={WifiIcon} size={40} />
    </div>
  );
});

export default WaitingAnim;
