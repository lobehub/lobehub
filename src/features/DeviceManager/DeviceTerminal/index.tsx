'use client';

import type { DeviceListItem } from '@lobechat/types';
import { ActionIcon, Button, Empty, Flexbox, Icon, Select, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import {
  CloudIcon,
  CloudOffIcon,
  LoaderCircleIcon,
  MonitorOffIcon,
  RotateCwIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import TerminalView from '@/features/ChatTerminal/TerminalView';
import { useManagedDeviceWake } from '@/features/WorkingDirectory/sources/useManagedDeviceWake';

import { getTerminalAvailability } from './availability';
import { useDeviceTerminalSession } from './useDeviceTerminalSession';
import { useTerminalGate } from './useTerminalGate';

/**
 * Select value for "start in the device user's home directory". Not an empty
 * string: the select renders an empty value as no selection, leaving the
 * trigger blank. A path never has this value.
 */
const HOME_CWD = '__home__';

const styles = stylex.create({
  frame: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',

    height: 'min(560px, calc(100vh - 320px))',
    minHeight: 320,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,

    backgroundColor: cssVar.colorBgContainer,
  },
  view: {
    overflow: 'hidden',
    flex: '1',
    minHeight: 0,
    paddingBlock: 8,
    paddingInline: 12,
  },
});

interface StateProps {
  action?: ReactNode;
  description?: string;
  icon: LucideIcon;
  spin?: boolean;
  title: string;
}

const TerminalState = memo<StateProps>(({ action, description, icon, spin, title }) => (
  <Flexbox align={'center'} flex={1} justify={'center'} padding={24}>
    <Empty
      action={action}
      description={description}
      icon={spin ? undefined : icon}
      image={spin ? <Icon spin icon={icon} size={32} /> : undefined}
      title={title}
    />
  </Flexbox>
));

interface DeviceTerminalProps {
  device: DeviceListItem;
}

/**
 * The device detail page's Terminal tab: one interactive shell on the device,
 * reusing the chat terminal's xterm view and device transport. The parent only
 * mounts it for a caller allowed to operate the device; the server checks the
 * same permission on every terminal call.
 */
const DeviceTerminal = memo<DeviceTerminalProps>(({ device }) => {
  const { t } = useTranslation('setting');
  const [cwd, setCwd] = useState(HOME_CWD);

  // A sleeping managed cloud device is started as soon as the tab opens, and
  // the shell waits for it to connect.
  const wake = useManagedDeviceWake(device.deviceId);
  const availability = getTerminalAvailability(device, wake.status);

  const gateOpen = useTerminalGate(availability);

  const { reopen, state } = useDeviceTerminalSession({
    cwd: cwd === HOME_CWD ? undefined : cwd,
    deviceId: device.deviceId,
    enabled: gateOpen,
    scope: device.scope,
  });
  const showAvailability = !gateOpen;

  const cwdOptions = useMemo(() => {
    const paths = [device.defaultCwd, ...(device.workingDirs ?? []).map((dir) => dir.path)];
    const unique = [...new Set(paths.filter((path): path is string => !!path))];
    return [
      { label: t('devices.terminal.cwdHome'), value: HOME_CWD },
      ...unique.map((path) => ({ label: path, value: path })),
    ];
  }, [device.defaultCwd, device.workingDirs, t]);

  const retryButton = (onClick: () => void) => (
    <Button icon={<Icon icon={RotateCwIcon} />} onClick={onClick}>
      {t('devices.terminal.retry')}
    </Button>
  );

  const renderBody = () => {
    if (showAvailability) return renderAvailability();
    return renderSession();
  };

  const renderAvailability = () => {
    switch (availability) {
      case 'checking': {
        return (
          <TerminalState spin icon={LoaderCircleIcon} title={t('devices.terminal.checking')} />
        );
      }
      case 'waking': {
        return (
          <TerminalState
            spin
            description={t('devices.terminal.wakingDesc')}
            icon={CloudIcon}
            title={t('devices.terminal.waking')}
          />
        );
      }
      case 'wakeSlow':
      case 'wakeFailed': {
        return (
          <TerminalState
            action={retryButton(wake.retry)}
            icon={CloudOffIcon}
            title={t(
              availability === 'wakeFailed'
                ? 'devices.terminal.wakeFailed'
                : 'devices.terminal.wakeSlow',
            )}
          />
        );
      }
      case 'offline': {
        return (
          <TerminalState
            description={t('devices.terminal.offlineDesc')}
            icon={MonitorOffIcon}
            title={t('devices.terminal.offline')}
          />
        );
      }
      default: {
        return (
          <TerminalState
            description={t('devices.terminal.unsupportedDesc')}
            icon={TriangleAlertIcon}
            title={t('devices.terminal.unsupported')}
          />
        );
      }
    }
  };

  const renderSession = () => {
    switch (state.status) {
      case 'open': {
        return (
          <div {...stylex.props(styles.view)}>
            <TerminalView sessionId={state.sessionId} />
          </div>
        );
      }
      case 'exited': {
        return (
          <TerminalState
            icon={SquareTerminalIcon}
            title={t('devices.terminal.exited')}
            action={
              <Button icon={<Icon icon={SquareTerminalIcon} />} onClick={reopen}>
                {t('devices.terminal.reopen')}
              </Button>
            }
          />
        );
      }
      case 'error': {
        if (state.error === 'unsupported') {
          return (
            <TerminalState
              description={t('devices.terminal.unsupportedDesc')}
              icon={TriangleAlertIcon}
              title={t('devices.terminal.unsupported')}
            />
          );
        }
        return (
          <TerminalState
            action={retryButton(reopen)}
            description={state.error === 'offline' ? t('devices.terminal.offlineDesc') : undefined}
            icon={state.error === 'offline' ? MonitorOffIcon : TriangleAlertIcon}
            title={t(
              state.error === 'offline' ? 'devices.terminal.offline' : 'devices.terminal.failed',
            )}
          />
        );
      }
      default: {
        return (
          <TerminalState spin icon={LoaderCircleIcon} title={t('devices.terminal.connecting')} />
        );
      }
    }
  };

  const ready = gateOpen;

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        <Text fontSize={12} type={'secondary'}>
          {t('devices.terminal.cwd')}
        </Text>
        <Select
          disabled={!ready}
          options={cwdOptions}
          size={'small'}
          style={{ maxWidth: 360, minWidth: 180, width: 'auto' }}
          value={cwd}
          onChange={(value) => setCwd(String(value ?? HOME_CWD))}
        />
        <Flexbox flex={1} />
        <ActionIcon
          disabled={!ready || state.status === 'opening'}
          icon={RotateCwIcon}
          size={'small'}
          title={t('devices.terminal.restart')}
          onClick={reopen}
        />
      </Flexbox>
      <div {...stylex.props(styles.frame)}>{renderBody()}</div>
      <Text fontSize={12} type={'secondary'}>
        {t('devices.terminal.hint')}
      </Text>
    </Flexbox>
  );
});

DeviceTerminal.displayName = 'DeviceTerminal';

export default DeviceTerminal;
