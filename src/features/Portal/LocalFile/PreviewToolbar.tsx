import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Loader2Icon, type LucideIcon } from 'lucide-react';
import type { MouseEventHandler, ReactNode } from 'react';
import { memo } from 'react';

import PathBreadcrumb from './PathBreadcrumb';

const styles = stylex.create({
  action: {
    cursor: { 'default': 'pointer', ':disabled': 'not-allowed' },
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    height: '28px',
    paddingInline: '8px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadius,
    fontSize: '12px',
    lineHeight: 1,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
    backgroundImage: 'none',
    opacity: { 'default': null, ':disabled': 0.45 },
  },
  actionActive: { color: cssVar.colorText, backgroundColor: cssVar.colorFillSecondary },
  actionIcon: { display: 'inline-flex', alignItems: 'center' },
  actionLabel: {
    whiteSpace: 'nowrap',
    display: { 'default': null, '@container (max-width: 300px)': 'none' },
  },
  toggleLabel: { display: { 'default': null, '@container (max-width: 300px)': 'none' } },
  bar: {
    containerType: 'inline-size',
    flexShrink: 0,
    height: '40px',
    paddingInlineStart: '12px',
    paddingInlineEnd: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  path: {
    display: {
      'default': null,
      '@container (max-width: 440px)': {
        'default': null,
        ':has(~ [data-toolbar-actions] > *)': 'none',
      },
    },
    overflow: 'hidden',
    minWidth: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
  },
});

export const toolbarToggleClassNames = {
  itemLabel: stylex.props(styles.toggleLabel).className,
};

interface ToolbarActionButtonProps {
  active?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  label?: ReactNode;
  loading?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
}

export const ToolbarActionButton = memo<ToolbarActionButtonProps>(
  ({ active, disabled, icon, label, loading, onClick, title }) => {
    const button = (
      <button
        aria-label={title ?? (typeof label === 'string' ? label : undefined)}
        aria-pressed={active}
        className={stylex.props(styles.action, active && styles.actionActive).className}
        disabled={disabled || loading}
        type={'button'}
        onClick={onClick}
      >
        <Icon
          className={stylex.props(styles.actionIcon).className}
          icon={loading ? Loader2Icon : icon}
          size={14}
          spin={loading}
        />
        {label && <span {...stylex.props(styles.actionLabel)}>{label}</span>}
      </button>
    );

    return title ? <Tooltip title={title}>{button}</Tooltip> : button;
  },
);

ToolbarActionButton.displayName = 'ToolbarActionButton';

interface PreviewToolbarProps {
  actions?: ReactNode;
  /** Remote device the file lives on; local when absent. */
  deviceId?: string;
  path: string;
  /** Project root the path is shown relative to, when the file lives inside it. */
  rootPath?: string;
}

const PreviewToolbar = memo<PreviewToolbarProps>(({ actions, deviceId, path, rootPath }) => (
  <Flexbox
    horizontal
    align={'center'}
    className={stylex.props(styles.bar).className}
    gap={8}
    justify={'space-between'}
  >
    <Tooltip title={path}>
      <Flexbox horizontal align={'center'} className={stylex.props(styles.path).className} flex={1}>
        <PathBreadcrumb deviceId={deviceId} path={path} rootPath={rootPath} />
      </Flexbox>
    </Tooltip>
    {actions && (
      <Flexbox
        data-toolbar-actions
        horizontal
        align={'center'}
        flex={'none'}
        gap={2}
        style={{ marginInlineStart: 'auto' }}
      >
        {actions}
      </Flexbox>
    )}
  </Flexbox>
));

PreviewToolbar.displayName = 'PreviewToolbar';

export default PreviewToolbar;
