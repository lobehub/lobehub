'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { BarChart3Icon, LayoutDashboardIcon, ShieldIcon, UsersIcon } from 'lucide-react';
import { type FC, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const useStyles = createStyles(({ css, token }) => ({
  active: css`
    font-weight: 600;
    color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
  `,
  container: css`
    height: 100%;
    background: ${token.colorBgContainer};
  `,
  content: css`
    overflow-y: auto;
    flex: 1;

    height: 100%;
    padding: 24px;

    background: ${token.colorBgLayout};
  `,
  header: css`
    padding-block: 20px 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  headerTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  `,
  menuItem: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    margin-block: 2px;
    margin-inline: 8px;
    padding-block: 9px;
    padding-inline: 16px;
    border-radius: 8px;

    font-size: 14px;
    color: ${token.colorTextSecondary};

    transition: all 0.15s ease;

    &:hover {
      color: ${token.colorText};
      background: ${token.colorFillTertiary};
    }
  `,
  sidebar: css`
    overflow-y: auto;

    width: 220px;
    min-width: 220px;
    height: 100%;
    border-inline-end: 1px solid ${token.colorBorderSecondary};

    background: ${token.colorBgContainer};
  `,
}));

const NAV_ITEMS = [
  { icon: LayoutDashboardIcon, label: 'Overview', path: '/admin' },
  { icon: UsersIcon, label: 'Users', path: '/admin/users' },
  { icon: BarChart3Icon, label: 'Stats', path: '/admin/stats' },
  { icon: ShieldIcon, label: 'Content', path: '/admin/content' },
];

interface AdminLayoutProps {
  children: ReactNode;
}

const AdminLayout: FC<AdminLayoutProps> = ({ children }) => {
  const { styles, cx } = useStyles();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <Flexbox horizontal className={styles.container}>
      <div className={styles.sidebar}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>Admin Panel</span>
        </div>
        {NAV_ITEMS.map(({ icon, label, path }) => (
          <div
            className={cx(styles.menuItem, pathname === path && styles.active)}
            key={path}
            onClick={() => navigate(path)}
          >
            <Icon icon={icon} size={16} />
            {label}
          </div>
        ))}
      </div>
      <div className={styles.content}>{children}</div>
    </Flexbox>
  );
};

export default AdminLayout;
