'use client';

import { createStaticStyles } from 'antd-style';
import { BarChart3Icon, LayoutDashboardIcon, ShieldIcon, UsersIcon } from 'lucide-react';
import { type FC, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Flexbox, Icon } from '@lobehub/ui';

const useStyles = createStaticStyles(({ css, token }) => ({
  active: css`
    background: ${token.colorPrimaryBg};
    color: ${token.colorPrimary};
    font-weight: 600;
  `,
  container: css`
    height: 100%;
    background: ${token.colorBgContainer};
  `,
  content: css`
    flex: 1;
    height: 100%;
    overflow-y: auto;
    padding: 24px;
    background: ${token.colorBgLayout};
  `,
  header: css`
    padding: 20px 16px 12px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  headerTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorTextTertiary};
    letter-spacing: 0.06em;
    text-transform: uppercase;
  `,
  menuItem: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 16px;
    border-radius: 8px;
    margin: 2px 8px;
    cursor: pointer;
    font-size: 14px;
    color: ${token.colorTextSecondary};
    transition: all 0.15s ease;

    &:hover {
      background: ${token.colorFillTertiary};
      color: ${token.colorText};
    }
  `,
  sidebar: css`
    width: 220px;
    min-width: 220px;
    height: 100%;
    border-right: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    overflow-y: auto;
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
    <Flexbox className={styles.container} horizontal>
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
