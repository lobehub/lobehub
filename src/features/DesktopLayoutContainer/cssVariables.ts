import { cssVar } from '@lobehub/ui';

import { isDesktop } from '@/const/version';
import { getDarwinMajorVersion, isMacOSWithLargeWindowBorders } from '@/utils/platform';

export const CONTAINER_BORDER_WIDTH = 1;

const getContainerPaddingTop = (desktop: boolean) => (desktop ? 0 : 8);

export const getContainerTopInset = (desktop: boolean = isDesktop) =>
  getContainerPaddingTop(desktop) + CONTAINER_BORDER_WIDTH;

export const getOuterCssVariables = ({ expand }: { expand?: boolean }): Record<string, string> => ({
  '--container-padding-left': expand ? '0px' : '8px',
  '--container-padding-top': `${getContainerPaddingTop(isDesktop)}px`,
});

export const getInnerCssVariables = ({ isDark }: { isDark: boolean }): Record<string, string> => {
  const darwinMajorVersion = getDarwinMajorVersion();

  const borderRadius = darwinMajorVersion >= 25 ? '12px' : cssVar.borderRadius;
  const borderBottomRightRadius =
    darwinMajorVersion >= 26 || isMacOSWithLargeWindowBorders() ? '12px' : borderRadius;

  return {
    '--container-border-bottom-right-radius': borderBottomRightRadius,
    '--container-border-color': isDark ? cssVar.colorBorderSecondary : cssVar.colorBorder,
    '--container-border-radius': borderRadius,
  };
};
