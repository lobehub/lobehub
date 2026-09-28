import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { setFloatingCollisionPadding } from '@lobehub/ui/base-ui';

export const reserveTitleBarForFloatingLayers = () => {
  setFloatingCollisionPadding({ top: TITLE_BAR_HEIGHT });
};
