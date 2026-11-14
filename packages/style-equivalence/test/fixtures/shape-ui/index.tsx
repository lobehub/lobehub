import type { ReactNode } from 'react';

const sheet = document.createElement('style');
sheet.textContent = `@layer ui {
  .ui-button { flex: none; min-height: 32px; padding: 4px; }
  .ui-image-img { width: 10px; height: 10px; object-fit: fill; }
}`;
document.head.append(sheet);

export const Button = ({
  children,
  className,
  ...rest
}: {
  children?: ReactNode;
  className?: string;
}) => (
  <button className={['ui-button', className].filter(Boolean).join(' ')} {...rest}>
    <span>{children}</span>
  </button>
);

export const Image = ({
  classNames,
  ...rest
}: {
  alt?: string;
  classNames?: { image?: string };
}) => (
  <div className="ui-image" {...rest}>
    <div className="ui-image-wrapper">
      <img alt="" className={['ui-image-img', classNames?.image].filter(Boolean).join(' ')} />
    </div>
  </div>
);
