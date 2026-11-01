import { Rate as BaseRate, type RateProps } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  rate: { display: 'flex' },
});

const Rate = memo<RateProps>(({ className, size = 16, ...props }) => (
  <BaseRate allowHalf readOnly size={size} {...sx([styles.rate], className)} {...props} />
));

export default Rate;
