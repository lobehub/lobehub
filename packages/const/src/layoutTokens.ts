import type { ActionIconProps, FormProps } from '@lobehub/ui';

export const HEADER_HEIGHT = 64;
export const MOBILE_NABBAR_HEIGHT = 44;
export const MOBILE_TABBAR_HEIGHT = 48;
export const CHAT_TEXTAREA_MAX_HEIGHT = 800;
export const CHAT_TEXTAREA_HEIGHT = 160;
export const CHAT_TEXTAREA_HEIGHT_MOBILE = 108;
export const CHAT_SIDEBAR_WIDTH = 280;
export const CONVERSATION_MIN_WIDTH = 850;

export const CHAT_PORTAL_WIDTH = 400;
export const CHAT_PORTAL_MAX_WIDTH = 1280;
export const CHAT_PORTAL_TOOL_UI_WIDTH = 600;

export const MARKET_SIDEBAR_WIDTH = 400;
export const FOLDER_WIDTH = 270;
export const MAX_WIDTH = 1024;
export const FORM_STYLE: FormProps = {
  itemMinWidth: 'max(34%, 240px)',
  style: { maxWidth: MAX_WIDTH, width: '100%' },
};
export const MOBILE_HEADER_ICON_SIZE: ActionIconProps['size'] = { blockSize: 36, size: 22 };
export const DESKTOP_HEADER_ICON_SIZE: ActionIconProps['size'] = { blockSize: 32, size: 20 };
export const HEADER_ICON_SIZE = (mobile?: boolean) =>
  mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SIZE;
export const PWA_INSTALL_ID = 'pwa-install';
