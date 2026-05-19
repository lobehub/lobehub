'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { BarChart3Icon, LayoutDashboardIcon, ShieldIcon, UsersIcon } from 'lucide-react';
import { type CSSProperties, type FC, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const containerStyle: CSSProperties = {
    height: '100%',
    display: 'flex',
    backgroundColor: 'var(--lobe-color-bg-container, #fff)',
  };

  const sidebarStyle: CSSProperties = {
    width: 220,
    minWidth: 220,
    height: '100%',
    borderRight: '1px solid var(--lobe-color-border-secondary, #e5e5e5)',
    backgroundColor: 'var(--lobe-color-bg-container, #fff)',
    overflowY: 'auto',
  };

  const headerStyle: CSSProperties = {
    padding: '20px 16px 12px',
    borderBottom: '1px solid var(--lobe-color-border-secondary, #e5e5e5)',
  };

  const headerTitleStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--lobe-color-text-tertiary, #999)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  };

  const menuItemStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 16px',
    borderRadius: 8,
    margin: '2px 8px',
    cursor: 'pointer',
    fontSize: 14,
    color: 'var(--lobe-color-text-secondary, #666)',
    transition: 'all 0.15s ease',
  };

  const activeMenuItemStyle: CSSProperties = {
    ...menuItemStyle,
    color: 'var(--lobe-color-primary, #1890ff)',
    backgroundColor: 'var(--lobe-color-primary-bg, #e6f7ff)',
    fontWeight: 600,
  };

  const contentStyle: CSSProperties = {
    flex: 1,
    height: '100%',
    overflowY: 'auto',
    padding: 24,
    backgroundColor: 'var(--lobe-color-bg-layout, #fafafa)',
  };

  return (
    <Flexbox horizontal style={containerStyle}>
      <div style={sidebarStyle}>
        <div style={headerStyle}>
          <span style={headerTitleStyle}>Admin Panel</span>
        </div>
        {NAV_ITEMS.map(({ icon, label, path }) => (
          <div
            key={path}
            style={pathname === path ? activeMenuItemStyle : menuItemStyle}
            onClick={() => navigate(path)}
          >
            <Icon icon={icon} size={16} />
            {label}
          </div>
        ))}
      </div>
      <div style={contentStyle}>{children}</div>
    </Flexbox>
  );
};

export default AdminLayout;
