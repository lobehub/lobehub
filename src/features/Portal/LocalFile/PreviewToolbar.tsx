import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Loader2Icon, type LucideIcon } from 'lucide-react';
import type { MouseEventHandler, ReactNode } from 'react';
import { memo } from 'react';

import PathBreadcrumb from './PathBreadcrumb';

const styles = createStaticStyles(({ css }) => ({
  action: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    line-height: 1;
    color: ${cssVar.colorTextSecondary};

    background: none;

    /* Icon renders an inline .anticon span whose svg sits on the text
       baseline, floating icons a few px above center — flex-normalize it. */
    .anticon {
      display: inline-flex;
      align-items: center;
    }

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }
  `,
  actionActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  actionLabel: css`
    white-space: nowrap;

    @container (max-width: 300px) {
      display: none;
    }
  `,
  actions: css`
    @container (max-width: 300px) {
      .toggle-group-item-label {
        display: none;
      }
    }
  `,
  bar: css`
    container-type: inline-size;
    flex-shrink: 0;

    height: 40px;
    padding-inline: 12px 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  crumbGroup: css`
    overflow: hidden;

    /* Ancestors give up their width long before the filename does, so the file
       being previewed is the last thing to ellipsize. */
    flex-shrink: 100;
    min-width: 0;

    &:last-child {
      flex-shrink: 1;
    }
  `,
  separator: css`
    display: flex;
    flex: none;
    align-items: center;
    color: ${cssVar.colorTextQuaternary};
  `,
  path: css`
    overflow: hidden;
    min-width: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;

    /* Yield to the actions only when they actually rendered something —
       an all-hidden actions slot (e.g. plain code files) keeps the path. */
    @container (max-width: 440px) {
      &:has(~ [data-toolbar-actions] > *) {
        display: none;
      }
    }
  `,
}));

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
        className={cx(styles.action, active && styles.actionActive)}
        disabled={disabled || loading}
        type={'button'}
        onClick={onClick}
      >
        <Icon icon={loading ? Loader2Icon : icon} size={14} spin={loading} />
        {label && <span className={styles.actionLabel}>{label}</span>}
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
  <Flexbox horizontal align={'center'} className={styles.bar} gap={8} justify={'space-between'}>
    <Tooltip title={path}>
      <Flexbox horizontal align={'center'} className={styles.path} flex={1}>
        <PathBreadcrumb deviceId={deviceId} path={path} rootPath={rootPath} />
      </Flexbox>
    </Tooltip>
    {actions && (
      <Flexbox
        data-toolbar-actions
        horizontal
        align={'center'}
        className={styles.actions}
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
