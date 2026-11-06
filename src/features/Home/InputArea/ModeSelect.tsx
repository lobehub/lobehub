import { Button, Flexbox, Icon, Popover } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, InfinityIcon, ListTodoIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import type { HomeMode } from '../types';
import { isHomeModeDisabled, resolvePermittedHomeMode } from './modePermission';

const styles = stylex.create({
  activeOption: {
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  button: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    height: '32px',
    paddingInline: '8px',
    borderWidth: 0,
    borderRadius: cssVar.borderRadius,
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
    backgroundImage: 'none',
    transition: 'all 0.2s',
  },
  option: {
    overflow: 'hidden',
    justifyContent: 'flex-start',
    width: '100%',
    height: 'auto',
    paddingBlock: '10px',
    paddingInline: '8px',
    borderWidth: 0,
    borderRadius: cssVar.borderRadius,
    textAlign: 'start',
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  optionDesc: {
    overflow: 'hidden',
    fontSize: '12px',
    lineHeight: 1.4,
    color: cssVar.colorTextDescription,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  optionIcon: {
    flexShrink: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  optionTitle: {
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: 1.4,
    color: cssVar.colorText,
  },
  optionContent: {
    width: '100%',
    minWidth: 0,
  },
  optionText: {
    overflow: 'hidden',
    minWidth: 0,
  },
  // The popup pads its option rows by 4px, so its corner must be one step larger
  // than the rows' radius to wrap them concentrically.
  popoverPopup: {
    borderRadius: cssVar.borderRadiusLG,
  },
});

// Task mode carries the same glyph as the sidebar's Tasks entry: picking it
// here and opening that page are two doors onto one thing, so they must not
// look like two different features. Agent mode keeps the infinity mark, which
// is the product's own sign for the open-ended, keeps-going side of the pair.
const MODES = [
  { icon: InfinityIcon, key: 'chat' },
  { icon: ListTodoIcon, key: 'task' },
] as const;

interface ModeSelectProps {
  onChange: (mode: HomeMode) => void;
  value: HomeMode;
}

const ModeSelect = memo<ModeSelectProps>(({ onChange, value }) => {
  const { t } = useTranslation('home');
  const { t: tChat } = useTranslation('chat');
  const { allowed: canCreateContent, reason: createContentReason } =
    usePermission('create_content');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const permittedMode = resolvePermittedHomeMode(value, canCreateContent);
    if (permittedMode !== value) onChange(permittedMode);
  }, [canCreateContent, onChange, value]);

  const handleSelect = useCallback(
    (mode: HomeMode) => {
      setOpen(false);
      onChange(mode);
    },
    [onChange],
  );

  const current = MODES.find((mode) => mode.key === value) ?? MODES[0];

  const content = (
    <Flexbox gap={4} role={'menu'} style={{ maxWidth: 320, minWidth: 280 }}>
      {MODES.map(({ icon, key }) => {
        const disabled = isHomeModeDisabled(key, canCreateContent);

        return (
          <Button
            aria-checked={key === value}
            className={stylex.props(styles.option, key === value && styles.activeOption).className}
            disabled={disabled}
            key={key}
            role={'menuitemradio'}
            title={disabled ? createContentReason : undefined}
            type={'text'}
            onClick={() => handleSelect(key)}
          >
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.optionContent).className}
              gap={12}
            >
              <Flexbox
                align={'center'}
                className={stylex.props(styles.optionIcon).className}
                height={32}
                justify={'center'}
                width={32}
              >
                <Icon icon={icon} size={16} />
              </Flexbox>
              <Flexbox className={stylex.props(styles.optionText).className} flex={1}>
                <div className={stylex.props(styles.optionTitle).className}>
                  {t(`dashboard.mode.${key}`)}
                </div>
                <div className={stylex.props(styles.optionDesc).className}>
                  {key === 'chat' ? tChat('chatMode.agentDesc') : t('dashboard.modeDesc.task')}
                </div>
              </Flexbox>
            </Flexbox>
          </Button>
        );
      })}
    </Flexbox>
  );

  return (
    <Popover
      className={stylex.props(styles.popoverPopup).className}
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
      <Button
        aria-expanded={open}
        aria-haspopup={'menu'}
        className={stylex.props(styles.button).className}
        type={'text'}
      >
        <Icon icon={current.icon} size={14} />
        <span>{t(`dashboard.mode.${value}`)}</span>
        <Icon icon={ChevronDownIcon} size={12} />
      </Button>
    </Popover>
  );
});

export default ModeSelect;
