import { type IconType } from '@lobehub/icons';
import { cssVar, cx } from 'antd-style';

const StopLoadingIcon: IconType = (({ ref, size = 16, className, style, ...rest }) => {
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
        <circle
          cx="512"
          cy="512"
          fill="none"
          r="426"
          stroke={cssVar.colorBorder}
          strokeWidth="72"
        />
        <rect fill="currentColor" height="252" rx="24" ry="24" width="252" x="386" y="386" />
        <path
          d="M938.667 512C938.667 276.359 747.64 85.333 512 85.333"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="73"
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
}) as IconType;
export default StopLoadingIcon;
