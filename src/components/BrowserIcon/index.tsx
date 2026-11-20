import SiBrave from '@icons-pack/react-simple-icons/icons/SiBrave';
import SiFirefox from '@icons-pack/react-simple-icons/icons/SiFirefox';
import SiGooglechrome from '@icons-pack/react-simple-icons/icons/SiGooglechrome';
import SiOpera from '@icons-pack/react-simple-icons/icons/SiOpera';
import SiSafari from '@icons-pack/react-simple-icons/icons/SiSafari';
import SiSamsung from '@icons-pack/react-simple-icons/icons/SiSamsung';
import React, { memo } from 'react';

const lastVersion = {
  'Brave': SiBrave,
  'Chrome': SiGooglechrome,
  'Chromium': SiGooglechrome,
  'Firefox': SiFirefox,
  'Mobile Safari': SiSafari,
  'Opera': SiOpera,
  'Safari': SiSafari,
  'Samsung': SiSamsung,
};

export type Browsers = keyof typeof lastVersion;

interface BrowserIconProps {
  browser: string;
  className?: string;
  size: number | string;
  style?: React.CSSProperties;
}

export const BrowserIcon = memo<BrowserIconProps>(({ browser, className, style, size }) => {
  const Component = lastVersion[browser as Browsers];

  if (!Component) return null;

  return <Component className={className} size={size} style={style} />;
});
