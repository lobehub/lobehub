import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import type { MouseEventHandler, ReactNode } from 'react';
import { memo } from 'react';

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
    color: ${cssVar.colorTextSecondary};

    background: none;

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
  bar: css`
    container-type: inline-size;
    flex-shrink: 0;

    height: 40px;
    padding-inline: 12px 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  dir: css`
    overflow: hidden;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  name: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
  path: css`
    min-width: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;

    @container (max-width: 440px) {
      display: none;
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
        className={cx(styles.action, active && styles.actionActive)}
        disabled={disabled || loading}
        type={'button'}
        onClick={onClick}
      >
        <Icon icon={icon} size={14} spin={loading} />
        {label && <span className={styles.actionLabel}>{label}</span>}
      </button>
    );

    return title ? <Tooltip title={title}>{button}</Tooltip> : button;
  },
);

ToolbarActionButton.displayName = 'ToolbarActionButton';

interface PreviewToolbarProps {
  actions?: ReactNode;
  path: string;
}

const PreviewToolbar = memo<PreviewToolbarProps>(({ actions, path }) => {
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash > 0 ? path.slice(0, lastSlash) : '';
  const name = path.slice(lastSlash + 1);

  return (
    <Flexbox horizontal align={'center'} className={styles.bar} gap={8} justify={'space-between'}>
      <Tooltip title={path}>
        <Flexbox horizontal align={'center'} className={styles.path} flex={1}>
          {dir && <span className={styles.dir}>{dir}</span>}
          <span className={styles.name}>{dir ? `/${name}` : name}</span>
        </Flexbox>
      </Tooltip>
      {actions && (
        <Flexbox
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
  );
});

PreviewToolbar.displayName = 'PreviewToolbar';

export default PreviewToolbar;
