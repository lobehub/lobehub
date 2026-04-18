import { cssVar, cx } from 'antd-style';
import { type CSSProperties, type SVGProps } from 'react';

interface RingLoadingIconProps extends SVGProps<SVGSVGElement> {
  ringColor?: string;
  size?: number | string;
  style?: CSSProperties;
}

const RingLoadingIcon = ({
  ref,
  size = 16,
  className,
  style,
  ringColor = cssVar.colorBorder,
  ...rest
}: RingLoadingIconProps & { ref?: React.RefObject<SVGSVGElement | null> }) => {
  return (
    <svg
      className={cx('anticon', className)}
      color="currentColor"
      height={size}
      ref={ref}
      style={{ flex: 'none', lineHeight: 1, ...style }}
      viewBox="0 0 1024 1024"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <g fill="none">
        <circle cx="512" cy="512" fill="none" r="400" stroke={ringColor} strokeWidth="128" />
        <path
          d="M912 512C912 290.92 733.08 112 512 112"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="128"
        >
          <animateTransform
            attributeName="transform"
            dur="1s"
            from="0 512 512"
            repeatCount="indefinite"
            to="360 512 512"
            type="rotate"
          />
        </path>
      </g>
    </svg>
  );
};

export default RingLoadingIcon;
