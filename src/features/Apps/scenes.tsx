'use client';

import * as stylex from '@stylexjs/stylex';

import { APP_SHOTS } from './const';
import { styles } from './style';

export const DesktopScene = () => (
  <div {...stylex.props(styles.stage)}>
    <img
      alt=""
      {...stylex.props(styles.desktopShot, styles.lightOnly)}
      src={APP_SHOTS.desktopLight}
    />
    <img
      alt=""
      {...stylex.props(styles.desktopShot, styles.darkOnly)}
      src={APP_SHOTS.desktopDark}
    />
  </div>
);

export const MobileScene = () => (
  <div {...stylex.props(styles.mobileStage)}>
    <div {...stylex.props(styles.phone)}>
      <img alt="" {...stylex.props(styles.phoneShot)} loading="lazy" src={APP_SHOTS.mobile} />
    </div>
  </div>
);

export const CliScene = () => (
  <img alt="" {...stylex.props(styles.cliShot)} loading="lazy" src={APP_SHOTS.cli} />
);
