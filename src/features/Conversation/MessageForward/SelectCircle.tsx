'use client';

import { Center, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  checked: {
    borderColor: cssVar.colorPrimary,
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
  },
  circle: {
    flex: 'none',
    inlineSize: '20px',
    blockSize: '20px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '50%',
    transition: `background-color 0.15s ${cssVar.motionEaseInOut}, border-color 0.15s ${cssVar.motionEaseInOut}`,
  },
});

interface SelectCircleProps {
  checked?: boolean;
  className?: string;
}

/**
 * WeChat-style round selection indicator: a hollow circle that fills with the
 * primary color and a check when selected. Replaces the square antd Checkbox in
 * multi-select rows.
 */
const SelectCircle = memo<SelectCircleProps>(({ checked, className }) => (
  <Center {...sx([styles.circle, checked && styles.checked], className)}>
    {checked && <Icon icon={Check} size={14} />}
  </Center>
));

SelectCircle.displayName = 'SelectCircle';

export default SelectCircle;
