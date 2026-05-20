'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import {
  BarChart3Icon,
  FileTextIcon,
  FlagIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
} from 'lucide-react';
import { createStaticStyles } from 'antd-style';
import { type FC, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const useStyles = createStaticStyles(({ css, token }) => ({
  container: css`
    height: 100%;
    display: flex;
    background: ${token.colorBgLayout};
  `,
  sidebar: css`
    width: 220px;
    min-width: 220px;
    height: 100%;
    border-right: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  `,
  header: css`
    padding: 20px 16px 12px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  headerTitle: css`
    font-size: 11px;
    font-weight: 700;
    color: ${token.colorTextQuaternary};
    letter-spacing: 0.1em;
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
    user-select: none;
    &:hover {
      background: ${token.colorFillSecondary};
      color: ${token.colorText};
    }
  `,
  activeMenuItem: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 16px;
    border-radius: 8px;
    margin: 2px 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
    transition: all 0.15s ease;
    user-select: none;
  `,
  sectionLabel: css`
    padding: 16px 16px 4px;
    font-size: 11px;
    font-weight: 700;
    color: ${token.colorTextQuaternary};
    letter-spacing: 0.08em;
    text-transform: uppercase;
  `,
  content: css`
    flex: 1;
    height: 100%;
    overflow-y: auto;
    padding: 24px;
    background: ${token.colorBgLayout};
  `,
}));

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { icon: LayoutDashboardIcon, label: 'Dashboard', path: '/admin' },
      { icon: BarChart3Icon, label: 'Statistics', path: '/admin/stats' },
    ],
  },
  {
    label: 'User Management',
    items: [
      { icon: UsersIcon, label: 'Users', path: '/admin/users' },
      { icon: FlagIcon, label: 'Feature Flags', path: '/admin/feature-flags' },
    ],
  },
  {
    label: 'System',
    items: [
      { icon: KeyRoundIcon, label: 'API Keys', path: '/admin/api-keys' },
      { icon: ScrollTextIcon, label: 'Audit Log', path: '/admin/audit-log' },
      { icon: FileTextIcon, label: 'Content', path: '/admin/content' },
    ],
  },
];

interface AdminLayoutProps {
  children: ReactNode;
}

const AdminLayout: FC<AdminLayoutProps> = ({ children }) => {
  const { styles } = useStyles();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <div className={styles.header}>
          <Flexbox align="center" gap={8} horizontal>
            <Icon icon={ShieldIcon} size={16} />
            <span className={styles.headerTitle}>Admin Console</span>
          </Flexbox>
        </div>
        {NAV_SECTIONS.map(({ label, items }) => (
          <div key={label}>
            <div className={styles.sectionLabel}>{label}</div>
            {items.map(({ icon, label: itemLabel, path }) => (
              <div
                key={path}
                className={pathname === path ? styles.activeMenuItem : styles.menuItem}
                onClick={() => navigate(path)}
              >
                <Icon icon={icon} size={15} />
                {itemLabel}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
};

export default AdminLayout;
