import { isDesktop } from '@lobechat/const';
import type { OpenInAppId } from '@lobechat/electron-client-ipc';
import { DropdownMenu, type DropdownMenuProps, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { APP_ICONS } from './apps';
import { useOpenInApp } from './useOpenInApp';

interface AppIconProps {
  icon?: string;
  id: OpenInAppId;
  size?: number;
}

const AppIcon = ({ id, icon, size = 16 }: AppIconProps) => {
  if (icon) {
    return (
      <img
        alt=""
        height={size}
        src={icon}
        style={{ display: 'block', objectFit: 'contain' }}
        width={size}
      />
    );
  }
  const Fallback = APP_ICONS[id];
  return <Icon icon={Fallback} size={size} />;
};

const styles = stylex.create({
  leftButton: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: '8px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rightButton: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: '4px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  root: {
    overflow: 'hidden',
    display: 'inline-flex',
    alignItems: 'stretch',
    height: '24px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '6px',
  },
});

export interface OpenInAppButtonProps {
  className?: string;
  workingDirectory: string;
}

const OpenInAppButton = memo<OpenInAppButtonProps>(({ workingDirectory, className }) => {
  const { t } = useTranslation('openInApp');
  const { defaultApp, installedApps, launch, ready } = useOpenInApp(workingDirectory);

  const defaultAppEntry = useMemo(
    () => installedApps.find((app) => app.id === defaultApp),
    [installedApps, defaultApp],
  );

  const defaultDisplayName = defaultAppEntry?.displayName ?? defaultApp;
  const defaultIconSrc = defaultAppEntry?.icon;

  const dropdownItems = useMemo<DropdownMenuProps['items']>(
    () =>
      installedApps.map((app) => ({
        icon: <AppIcon icon={app.icon} id={app.id} size={14} />,
        key: app.id,
        label: app.displayName,
        onClick: () => {
          void launch(app.id);
        },
      })),
    [installedApps, launch],
  );

  if (!isDesktop || !workingDirectory) return null;
  if (!ready) return null;

  const wrapperClassName = [stylex.props(styles.root).className, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClassName}>
      <Tooltip title={t('tooltip', { appName: defaultDisplayName })}>
        <div
          aria-label={t('tooltip', { appName: defaultDisplayName })}
          {...stylex.props(styles.leftButton)}
          role="button"
          onClick={() => {
            void launch(defaultApp);
          }}
        >
          <AppIcon icon={defaultIconSrc} id={defaultApp} size={14} />
        </div>
      </Tooltip>
      <DropdownMenu items={dropdownItems} trigger={['click']}>
        <div aria-label={t('dropdownLabel')} {...stylex.props(styles.rightButton)} role="button">
          <Icon icon={ChevronDownIcon} size={12} />
        </div>
      </DropdownMenu>
    </div>
  );
});

OpenInAppButton.displayName = 'OpenInAppButton';

export default OpenInAppButton;
