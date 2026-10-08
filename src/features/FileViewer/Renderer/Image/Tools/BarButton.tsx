'use client';

import { Button, type ButtonProps } from '@lobehub/ui/base-ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useImageStage } from '../context';

interface BarButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'shape' | 'size'> {
  /** Shown after the label (e.g. a count); dropped when the bar is compact. */
  extra?: ReactNode;
  icon: LucideIcon;
  label: string;
}

/**
 * A tool bar button: icon and label, or the icon alone (label as tooltip) when
 * the viewer is narrow, so a bar always stays on one line.
 */
const BarButton = ({ extra, icon, label, title, ...rest }: BarButtonProps) => {
  const { compact } = useImageStage();

  return compact ? (
    <Button
      {...rest}
      aria-label={label}
      icon={icon}
      shape={'circle'}
      size={'small'}
      title={title ?? label}
    />
  ) : (
    <Button {...rest} icon={icon} shape={'round'} size={'small'} title={title}>
      {label}
      {extra}
    </Button>
  );
};

export default BarButton;
