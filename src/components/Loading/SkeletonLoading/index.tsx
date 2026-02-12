'use client';

import { Skeleton } from '@lobehub/ui';
import { type SkeletonProps } from 'antd';
import { createStaticStyles, cx, responsive } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(
  ({ css }) => css`
    ${responsive.sm} {
      padding: 16px;
    }
  `,
);

const SkeletonLoading = memo<SkeletonProps>(
  ({ className, classNames, styles: customStyles, ...rest }) => {
    return (
      <Skeleton
        active
        className={cx(styles, className)}
        classNames={classNames as any}
        paragraph={{ rows: 8 }}
        styles={customStyles as any}
        {...rest}
      />
    );
  },
);

export default SkeletonLoading;
