'use client';

import { Center, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  checked: css`
    border-color: ${cssVar.colorPrimary};
    color: ${cssVar.colorBgContainer};
    background: ${cssVar.colorPrimary};
  `,
  circle: css`
    flex: none;

    inline-size: 20px;
    block-size: 20px;
    border: 1.5px solid ${cssVar.colorBorder};
    border-radius: 50%;

    transition:
      background-color 0.15s ${cssVar.motionEaseInOut},
      border-color 0.15s ${cssVar.motionEaseInOut};
  `,
}));

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
  <Center className={cx(styles.circle, checked && styles.checked, className)}>
    {checked && <Icon icon={Check} size={14} />}
  </Center>
));

SelectCircle.displayName = 'SelectCircle';

export default SelectCircle;
