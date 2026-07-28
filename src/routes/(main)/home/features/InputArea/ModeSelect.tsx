import { Flexbox, Icon } from '@lobehub/ui';
import { Popover } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, InfinityIcon, MessageCircleIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { HomeMode } from '../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  activeOption: css`
    background: ${cssVar.colorFillSecondary};
  `,
  // 32px matches the + and send buttons flanking it, so every round control on
  // the bar shares one corner radius and one clearance from the container edge.
  button: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    height: 32px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  option: css`
    cursor: pointer;

    width: 100%;
    padding-block: 10px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  optionDesc: css`
    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextDescription};
  `,
  optionIcon: css`
    flex-shrink: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  optionTitle: css`
    font-size: 14px;
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  popoverPopup: css`
    /* The popup pads its option rows by 4px, so its corner must be one step larger
       than the rows' radius to wrap them concentrically. &&& outranks the base
       popup style's border-radius. */
    &&& {
      border-radius: ${cssVar.borderRadiusLG};
    }
  `,
}));

/**
 * The two modes are the runtime's existing chat / agent split, so they borrow
 * that copy rather than restating it. `note` is deliberately absent — the mode
 * still works end to end, it just isn't finished enough to offer.
 */
const MODES = [
  { descKey: 'chatMode.chatDesc', icon: MessageCircleIcon, key: 'chat' },
  { descKey: 'chatMode.agentDesc', icon: InfinityIcon, key: 'task' },
] as const;

interface ModeSelectProps {
  onChange: (mode: HomeMode) => void;
  value: HomeMode;
}

const ModeSelect = memo<ModeSelectProps>(({ onChange, value }) => {
  const { t } = useTranslation('home');
  const { t: tChat } = useTranslation('chat');
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    (mode: HomeMode) => {
      setOpen(false);
      onChange(mode);
    },
    [onChange],
  );

  const current = MODES.find((mode) => mode.key === value) ?? MODES[0];

  const content = (
    <Flexbox gap={4} style={{ maxWidth: 320, minWidth: 280 }}>
      {MODES.map(({ descKey, icon, key }) => (
        <Flexbox
          horizontal
          align={'center'}
          className={cx(styles.option, key === value && styles.activeOption)}
          gap={12}
          key={key}
          onClick={() => handleSelect(key)}
        >
          <Flexbox
            align={'center'}
            className={styles.optionIcon}
            height={32}
            justify={'center'}
            width={32}
          >
            <Icon icon={icon} size={16} />
          </Flexbox>
          <Flexbox flex={1}>
            <div className={styles.optionTitle}>{t(`dashboard.mode.${key}`)}</div>
            <div className={styles.optionDesc}>{tChat(descKey)}</div>
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );

  return (
    <Popover
      className={styles.popoverPopup}
      content={content}
      open={open}
      placement={'bottomLeft'}
      trigger={'click'}
      styles={{
        content: {
          border: `1px solid ${cssVar.colorBorderSecondary}`,
          borderRadius: cssVar.borderRadiusLG,
          padding: 4,
        },
      }}
      onOpenChange={setOpen}
    >
      <div className={styles.button}>
        <Icon icon={current.icon} size={14} />
        <span>{t(`dashboard.mode.${value}`)}</span>
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    </Popover>
  );
});

export default ModeSelect;
