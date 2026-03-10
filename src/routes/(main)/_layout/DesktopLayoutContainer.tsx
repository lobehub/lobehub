import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type FC, type PropsWithChildren } from 'react';
import { useMemo } from 'react';

import { isDesktop } from '@/const/version';
import { useIsDark } from '@/hooks/useIsDark';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { getDarwinMajorVersion, isMacOSWithLargeWindowBorders } from '@/utils/platform';

import { styles } from './DesktopLayoutContainer/style';

const DesktopLayoutContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();
  const [expand] = useGlobalStore((s) => [systemStatusSelectors.showLeftPanel(s)]);

  // CSS 变量用于动态样式
  const outerCssVariables = useMemo<Record<string, string>>(
    () => ({
      '--container-padding-left': expand ? '0px' : '8px',
      '--container-padding-top': isDesktop ? '0px' : '8px',
    }),
    [expand, isDesktop],
  );

  const innerCssVariables = useMemo<Record<string, string>>(() => {
    const darwinMajorVersion = getDarwinMajorVersion();

    const borderRadius = darwinMajorVersion >= 25 ? '12px' : cssVar.borderRadius;
    const borderBottomRightRadius =
      darwinMajorVersion >= 26 || isMacOSWithLargeWindowBorders() ? '12px' : borderRadius;

    return {
      '--container-border-bottom-right-radius': borderBottomRightRadius,
      '--container-border-color': isDarkMode ? cssVar.colorBorderSecondary : cssVar.colorBorder,
      '--container-border-radius': borderRadius,
    };
  }, [isDarkMode]);

  return (
    <Flexbox
      className={styles.outerContainer}
      height={'100%'}
      padding={8}
      style={outerCssVariables}
      width={'100%'}
    >
      <Flexbox
        className={styles.innerContainer}
        height={'100%'}
        style={innerCssVariables}
        width={'100%'}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
};
export default DesktopLayoutContainer;
