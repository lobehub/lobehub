import { memo, type SVGProps } from 'react';

interface AccordionArrowIconProps extends Omit<SVGProps<SVGSVGElement>, 'fill'> {
  isOpen?: boolean;
  size?: number | string;
}

const AccordionArrowIcon = memo<AccordionArrowIconProps>(
  ({ isOpen = false, size = 18, style, ...rest }) => (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      style={{
        flex: 'none',
        lineHeight: 1,
        transform: isOpen ? 'rotate(90deg)' : undefined,
        transition: 'transform 200ms',
        ...style,
      }}
      {...rest}
    >
      <path d="M7.002 10.624a.5.5 0 01-.752-.432V5.808a.5.5 0 01.752-.432l3.758 2.192a.5.5 0 010 .864l-3.758 2.192z" />
    </svg>
  ),
);

export default AccordionArrowIcon;
