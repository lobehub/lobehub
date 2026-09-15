'use client';

import { APP_SHOTS } from './const';
import { styles } from './style';

export const DesktopScene = () => (
  <div className={styles.stage}>
    <img
      alt=""
      className={`${styles.desktopShot} ${styles.lightOnly}`}
      src={APP_SHOTS.desktopLight}
    />
    <img
      alt=""
      className={`${styles.desktopShot} ${styles.darkOnly}`}
      src={APP_SHOTS.desktopDark}
    />
  </div>
);

export const MobileScene = () => (
  <div className={styles.mobileStage}>
    <div className={styles.phone}>
      <img alt="" className={styles.phoneShot} loading="lazy" src={APP_SHOTS.mobile} />
    </div>
  </div>
);

export const CliScene = () => (
  <img alt="" className={styles.cliShot} loading="lazy" src={APP_SHOTS.cli} />
);
