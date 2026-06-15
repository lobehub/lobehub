import { type CSSProperties, memo } from 'react';

interface LoadingIconProps {
  label?: string;
  size?: number;
}

const containerStyle: CSSProperties = {
  color: 'var(--colorTextSecondary, #8c8c8c)',
  display: 'inline-flex',
  flex: 'none',
  lineHeight: 0,
};

const LoadingIcon = memo<LoadingIconProps>(({ label, size = 48 }) => (
  <span
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'status' : undefined}
    style={{ ...containerStyle, height: size, width: size }}
  >
    <svg
      fill="none"
      height={size}
      viewBox="0 0 48 48"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="24" r="18" stroke="var(--colorBorder, #d9d9d9)" strokeWidth="4" />
      <path
        d="M42 24a18 18 0 0 0-18-18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="4"
      >
        <animateTransform
          attributeName="transform"
          dur="1s"
          from="0 24 24"
          repeatCount="indefinite"
          to="360 24 24"
          type="rotate"
        />
      </path>
    </svg>
  </span>
));

LoadingIcon.displayName = 'AuthLoadingIcon';

export default LoadingIcon;
