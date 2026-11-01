import type { IconType } from '@lobehub/icons';
import type { ImgHTMLAttributes } from 'react';
import { memo } from 'react';

export const DROID_AVATAR_URL = 'https://factory.ai/favicon.svg';

interface DroidAvatarProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'height' | 'src' | 'width'
> {
  shape?: 'circle' | 'square';
  size?: number;
}

const DroidAvatar = ({
  alt = 'Factory Droid',
  shape = 'circle',
  size = 40,
  style,
  ...rest
}: DroidAvatarProps) => (
  <img
    {...rest}
    alt={alt}
    height={size}
    src={DROID_AVATAR_URL}
    style={{ borderRadius: shape === 'circle' ? '50%' : '20%', ...style }}
    width={size}
  />
);

const DroidIconBase: IconType = memo(
  ({ 'aria-label': ariaLabel = 'Factory Droid', size = '1em', ...rest }) => (
    <svg
      {...rest}
      aria-label={ariaLabel}
      height={size}
      role="img"
      viewBox="0 0 508 508"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <image height="508" href={DROID_AVATAR_URL} width="508" />
    </svg>
  ),
);

export const DroidIcon = DroidIconBase as typeof DroidIconBase & {
  Avatar: typeof DroidAvatar;
  colorPrimary: string;
  title: string;
};

DroidIcon.Avatar = DroidAvatar;
DroidIcon.colorPrimary = '#020202';
DroidIcon.title = 'Factory Droid';
