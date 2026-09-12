import type { DevicePoolEffect } from '@lobechat/types';
import { devicePoolEffects } from '@lobechat/types';
import { ToggleGroup } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Check, Slash, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Fixed semantic hues keep allow/deny recognizable across custom themes and white icons legible. */
const styles = createStaticStyles(({ css, cssVar }) => ({
  allow: css`
    &&:not([data-disabled]) {
      color: #39965b;
    }

    &&[data-pressed]:not([data-disabled]) {
      color: ${cssVar.colorWhite};
      background: #237a48;
    }
  `,
  deny: css`
    &&:not([data-disabled]) {
      color: #e05a65;
    }

    &&[data-pressed]:not([data-disabled]) {
      color: ${cssVar.colorWhite};
      background: #bc3044;
    }
  `,
  inherit: css`
    &&:not([data-disabled]) {
      color: ${cssVar.colorTextSecondary};
    }

    &&[data-pressed]:not([data-disabled]) {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFill};
    }
  `,
  item: css`
    && {
      width: 36px;
      height: 30px;
      padding: 0;
    }

    &&:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -3px;
    }

    @media (prefers-reduced-motion: reduce) {
      && {
        transition: none;
      }
    }
  `,
  root: css`
    flex-shrink: 0;
  `,
}));

/** Compact three-state use permission control, shared by pool defaults and Agent overrides. */
interface DevicePoolPermissionToggleProps {
  /** Prevent changes while saving or when the viewer cannot manage the pool. */
  disabled?: boolean;
  /** Identity and entry label used to distinguish controls for assistive technology. */
  label: string;
  /** Receives the explicitly selected permission; selecting the active value keeps it selected. */
  onChange: (value: DevicePoolEffect) => void;
  /** Current explicit permission or inheritance. */
  value: DevicePoolEffect;
}

/**
 * Renders deny, inherit, and allow as a connected icon control.
 *
 * Use when:
 * - Editing a device pool fallback or one identity's entry permission
 *
 * Expects:
 * - A localized context label and a controlled permission value
 *
 * Returns:
 * - Keyboard-operable toggles with accessible names and native hover descriptions
 */
export function DevicePoolPermissionToggle({
  disabled,
  label,
  onChange,
  value,
}: DevicePoolPermissionToggleProps) {
  const { t } = useTranslation('setting');
  const icons = { allow: Check, deny: X, inherit: Slash };
  return (
    <ToggleGroup<DevicePoolEffect>
      className={styles.root}
      classNames={{ item: styles.item }}
      disabled={disabled}
      value={value}
      variant="outlined"
      options={devicePoolEffects.map((effect) => {
        const Icon = icons[effect];
        return {
          className: styles[effect],
          icon: <Icon aria-hidden size={18} strokeWidth={2.25} />,
          title: `${label} · ${t(`devicePools.effect.${effect}`)}`,
          value: effect,
        };
      })}
      onChange={onChange}
    />
  );
}
