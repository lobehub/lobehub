'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FileTextIcon } from 'lucide-react';
import { memo } from 'react';

const useStyles = createStaticStyles(({ css, token }) => ({
  empty: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 240px;
    gap: 12px;
    color: ${token.colorTextQuaternary};
    background: ${token.colorBgContainer};
    border-radius: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    margin-top: 16px;
  `,
}));

const AdminContent = memo(() => {
  const { styles } = useStyles();

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>Content Management</div>
      <div className={styles.empty}>
        <FileTextIcon size={40} strokeWidth={1} />
        <Text type="secondary">Content management coming soon</Text>
      </div>
    </div>
  );
});

AdminContent.displayName = 'AdminContent';

export default AdminContent;
