import type { FC } from 'react';

interface MatrixIconProps {
  className?: string;
  color?: string;
  size?: number;
}

/**
 * Matrix protocol logo (the bracketed "m"). `@lobehub/ui/icons` ships no
 * Matrix icon, so we render the official monochrome mark inline and let it
 * inherit the current text color for theme adaptation.
 *
 * @see https://matrix.org/docs/legal/brand/
 */
const MatrixIcon: FC<MatrixIconProps> = ({ className, color = 'currentColor', size = 20 }) => (
  <svg
    className={className}
    fill={color}
    height={size}
    viewBox="0 0 27.9 32"
    width={(size * 27.9) / 32}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M.038 0v32h2.243v-.579h-.972V.579h.972V0z" />
    <path d="M8.062 10.355v1.146h.032c.306-.436.675-.772 1.105-1.01.43-.239.925-.358 1.483-.358.535 0 1.023.104 1.466.312.442.208.779.575 1.01 1.1.251-.372.594-.7 1.027-.984.434-.284.946-.426 1.537-.426.448 0 .865.055 1.248.164.384.11.712.286.985.525.273.24.485.553.638.937.153.384.23.854.23 1.406v5.682h-2.32v-4.813c0-.287-.011-.557-.033-.809a1.74 1.74 0 0 0-.16-.66 1.03 1.03 0 0 0-.398-.443c-.175-.109-.411-.163-.71-.163-.3 0-.541.057-.726.171a1.24 1.24 0 0 0-.434.45 1.84 1.84 0 0 0-.214.639 5.1 5.1 0 0 0-.057.766v4.862h-2.32v-4.763c0-.252-.005-.503-.016-.75a2.14 2.14 0 0 0-.123-.686 1.04 1.04 0 0 0-.377-.5c-.17-.125-.424-.188-.761-.188-.098 0-.23.022-.393.066a1.25 1.25 0 0 0-.476.246 1.43 1.43 0 0 0-.394.525c-.109.23-.163.532-.163.906v5.144h-2.32v-9.311z" />
    <path d="M27.862 32V0H25.62v.579h.971v30.842h-.971V32z" />
  </svg>
);

export default MatrixIcon;
