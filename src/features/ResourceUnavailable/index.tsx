'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { EyeOffIcon } from 'lucide-react';
import { type CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';

export type ResourceUnavailableVariant = 'card' | 'inline' | 'attachment';

export interface ResourceUnavailableProps {
  className?: string;
  size?: 'small' | 'default';
  style?: CSSProperties;
  /**
   * Rendering shell. `inline` — pill-sized replacement for a text mention;
   * `attachment` — chat message file-card slot; `card` — larger placeholder
   * for detail-page mounts (agent editor's KB list, topic sidebar link).
   *
   * The message copy stays the same across all three — the surrounding
   * context (an attachment slot, a KB tile, a linked-doc chip) already tells
   * the viewer what kind of thing went missing, so we don't repeat it.
   */
  variant?: ResourceUnavailableVariant;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  attachment: css`
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
  `,
  card: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    color: ${cssVar.colorTextDescription};

    background: ${cssVar.colorFillQuaternary};
  `,
  icon: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  inline: css`
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
  `,
  small: css`
    font-size: 12px;
  `,
}));

/**
 * `ResourceUnavailable`
 *
 * Uniform placeholder rendered wherever a cross-user reference resolves to a
 * resource the current viewer no longer has access to — typically because the
 * creator flipped it back to `private` via `setVisibility`. Kept
 * intentionally low-emphasis so message threads don't scream at readers who
 * didn't do anything wrong.
 */
const ResourceUnavailable = memo<ResourceUnavailableProps>(
  ({ variant = 'inline', size = 'default', className, style }) => {
    const { t } = useTranslation('common');

    const iconSize = size === 'small' || variant === 'inline' ? 12 : 16;
    const shellClass = styles[variant];
    const sizeClass = size === 'small' && variant !== 'inline' ? styles.small : '';
    const mergedClass = [shellClass, sizeClass, className].filter(Boolean).join(' ');

    return (
      <Flexbox
        align="center"
        className={mergedClass}
        direction="horizontal"
        gap={variant === 'inline' ? 4 : 8}
        style={style}
      >
        <Icon className={styles.icon} icon={EyeOffIcon} size={iconSize} />
        <span>{t('resourceUnavailable')}</span>
      </Flexbox>
    );
  },
);

ResourceUnavailable.displayName = 'ResourceUnavailable';

export default ResourceUnavailable;
