import type { FlexboxProps } from '@lobehub/ui';
import type { CSSProperties, ReactNode, Ref } from 'react';

export interface ListItemProps extends Omit<FlexboxProps, 'title'> {
  actions?: ReactNode;
  active?: boolean;
  addon?: ReactNode;
  avatar?: ReactNode;
  classNames?: {
    actions?: string;
    container?: string;
    content?: string;
    date?: string;
    desc?: string;
    pin?: string;
    title?: string;
  };
  date?: number;
  description?: ReactNode;
  key: string;
  loading?: boolean;
  onHoverChange?: (hover: boolean) => void;
  pin?: boolean;
  ref?: Ref<HTMLDivElement>;
  showAction?: boolean;
  styles?: {
    actions?: CSSProperties;
    container?: CSSProperties;
    content?: CSSProperties;
    date?: CSSProperties;
    desc?: CSSProperties;
    pin?: CSSProperties;
    title?: CSSProperties;
  };
  title: ReactNode;
}
