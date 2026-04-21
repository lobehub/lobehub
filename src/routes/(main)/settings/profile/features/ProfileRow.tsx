'use client';

import { Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type ReactNode } from 'react';

interface ProfileRowProps {
  action?: ReactNode;
  children?: ReactNode;
  label: ReactNode;
}

const styles = createStaticStyles(({ css, responsive }) => ({
  action: css`
    flex-shrink: 0;
  `,
  body: css`
    display: flex;
    flex: 1;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
  `,
  label: css`
    flex: 0 0 160px;

    ${responsive.md} {
      flex: 0 0 auto;
    }
  `,
  row: css`
    display: flex;
    gap: 24px;
    align-items: center;

    min-height: 48px;
    padding-block: 16px;

    ${responsive.md} {
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
    }
  `,
}));

const ProfileRow = ({ label, children, action }: ProfileRowProps) => {
  return (
    <div className={styles.row}>
      <div className={styles.label}>
        {typeof label === 'string' ? <Text strong>{label}</Text> : label}
      </div>
      <div className={styles.body}>
        {children}
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  );
};

export default ProfileRow;
