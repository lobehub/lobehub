import type { DeviceListeningPort } from '@lobechat/types';
import {
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  Icon,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CopyIcon,
  GlobeIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ServerIcon,
  XIcon,
} from 'lucide-react';
import {
  type KeyboardEvent,
  memo,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceTunnelLink } from '@/store/device';

import { OverviewRow, PickerGlyph } from './OverviewRow';
import { usePortTunnels } from './usePortTunnels';

const styles = stylex.create({
  action: {
    cursor: 'pointer',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: '4px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorder },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
  },
  actions: {
    display: 'flex',
    flexShrink: 0,
    gap: '2px',
    alignItems: 'center',
    // Pull the last glyph flush with the text trailing of the other rows.
    marginInlineEnd: '-4px',
  },
  available: { fontSize: '12px', color: cssVar.colorPrimary },
  command: {
    overflow: 'hidden',
    flexShrink: 1,
    minWidth: 0,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  container: { display: 'flex', flexDirection: 'column', width: '260px', padding: '4px' },
  empty: {
    paddingBlock: '10px',
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  expose: { flexShrink: 0, fontSize: '12px', fontWeight: 500 },
  /**
   * A port that is running but not exposed yet stays one step quieter than an
   * exposed one; the full text color is kept for what is actually reachable.
   * Port, glyph and "Open" inherit it, so hover lifts the whole row at once.
   */
  idle: {
    color: {
      'default': cssVar.colorTextSecondary,
      ':hover': cssVar.colorText,
      '[data-highlighted]': cssVar.colorText,
    },
  },
  host: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlockStart: '6px',
    paddingBlockEnd: '4px',
    paddingInlineStart: '8px',
    paddingInlineEnd: '4px',
    fontSize: '11px',
    fontWeight: 500,
    color: cssVar.colorTextTertiary,
  },
  item: { display: 'flex', gap: '8px', alignItems: 'center' },
  othersList: {
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    // A dev machine listens on dozens of ports; the list scrolls inside the
    // menu instead of pushing it past the viewport.
    maxHeight: '200px',
  },
  port: {
    flexShrink: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorText,
  },
  portIdle: { color: 'inherit' },
  retry: {
    cursor: 'pointer',
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    fontSize: '12px',
    color: cssVar.colorInfo,
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  spacer: { flex: '1', minWidth: 0 },
  state: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    paddingBlock: '10px',
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  toggle: { fontSize: '12px', color: cssVar.colorTextTertiary },
});

interface PortSwitcherProps {
  /** Whether the working panel is showing; detection only runs while it is. */
  active: boolean;
  deviceId: string;
  /** Project directory, so the device can say which ports belong to it. */
  workingDirectory?: string;
}

/**
 * The ports of the working device, as one list: ports that already have a link
 * sit on top (open, copy, stop), the project's running servers follow with one
 * click to expose, and everything else listening on the machine is folded away.
 *
 * Opening is two-step by design: the stored link is clean, and the token that
 * opens it is minted per click, so nothing long-lived sits in the UI or the
 * clipboard.
 */
const PortSwitcher = memo<PortSwitcherProps>(({ active, deviceId, workingDirectory }) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const {
    busySlug,
    copyLink,
    creatingPort,
    detected,
    detectionAvailable,
    detectionChecking,
    detectionLoading,
    exposePort,
    isLoading,
    listFailed,
    openLink,
    otherPorts,
    refresh,
    refreshDetected,
    refreshFailed,
    revokeLink,
    tunnels,
  } = usePortTunnels({ active, cwd: workingDirectory, deviceId, onOpened: close, open });

  /**
   * Port, then process. No "this project" tag: the main list only holds the
   * project's own ports, and the rest are already folded under "Other ports".
   */
  const renderLabel = (port: number, info?: DeviceListeningPort) => (
    <>
      <span {...stylex.props(styles.port, styles.portIdle)}>{port}</span>
      {info?.command && (
        <span {...stylex.props(styles.command)} title={info.cwd}>
          {info.command}
        </span>
      )}
      <span {...stylex.props(styles.spacer)} />
    </>
  );

  /**
   * A small button inside the menu: it acts on its own and never opens the
   * tunnel. Kept out of the tab order because the menu focuses its first
   * tabbable element on open, which would land here and pop its tooltip on
   * every open; the menu items it sits on are reachable with the arrow keys.
   */
  const ownPress = (onPress: () => void) => ({
    // Enter/Space must act on this button, not fall through to the menu item.
    onKeyDown: (event: KeyboardEvent) => event.stopPropagation(),
    tabIndex: -1,
    onClick: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onPress();
    },
  });

  const renderLink = (link: DeviceTunnelLink) => (
    <DropdownMenuItem
      {...stylex.props(styles.item)}
      key={link.slug}
      onClick={(event) => {
        event.preventDefault();
        void openLink(link);
      }}
    >
      <Icon
        icon={busySlug === link.slug ? LoaderCircleIcon : GlobeIcon}
        size={14}
        spin={busySlug === link.slug}
      />
      {/* The link itself, so the row says where the port is reachable; copy sits
          right beside it. A link starts with its port (`5199--slug.lobe.sh`),
          so the port is drawn as the link's own prefix instead of repeated
          before it — that leaves room for the whole domain. */}
      <span {...stylex.props(styles.host)} title={link.hostname}>
        {link.hostname.startsWith(`${link.port}--`) ? (
          <>
            <span {...stylex.props(styles.port)}>{link.port}</span>
            {link.hostname.slice(String(link.port).length)}
          </>
        ) : (
          link.hostname
        )}
      </span>
      <span {...stylex.props(styles.actions)}>
        <Tooltip title={t('workingPanel.overview.ports.copy')}>
          <button
            aria-label={t('workingPanel.overview.ports.copy')}
            {...stylex.props(styles.action)}
            type={'button'}
            {...ownPress(() => void copyLink(link))}
          >
            <Icon icon={CopyIcon} size={13} />
          </button>
        </Tooltip>
        <Tooltip title={t('workingPanel.overview.ports.revoke')}>
          <button
            aria-label={t('workingPanel.overview.ports.revoke')}
            {...stylex.props(styles.action)}
            type={'button'}
            {...ownPress(() => void revokeLink(link))}
          >
            <Icon icon={XIcon} size={13} />
          </button>
        </Tooltip>
      </span>
    </DropdownMenuItem>
  );

  const renderDetected = (item: DeviceListeningPort) => (
    <DropdownMenuItem
      {...stylex.props(styles.item, styles.idle)}
      // A port from an earlier probe may have stopped: shown, not exposable,
      // until the device confirms it still listens.
      disabled={detectionChecking}
      key={item.port}
      onClick={(event) => {
        event.preventDefault();
        void exposePort(item.port);
      }}
    >
      <Icon
        icon={creatingPort === item.port ? LoaderCircleIcon : ServerIcon}
        size={14}
        spin={creatingPort === item.port}
      />
      {renderLabel(item.port, item)}
      <span {...stylex.props(styles.expose)}>
        {t('workingPanel.overview.ports.detected.expose')}
      </span>
    </DropdownMenuItem>
  );

  const checkingState = (
    <div {...stylex.props(styles.state)}>
      <Icon spin icon={LoaderCircleIcon} size={13} />
      {t('workingPanel.overview.ports.detected.checking')}
    </div>
  );

  const loadFailedState = (
    <div {...stylex.props(styles.state)}>
      {t('workingPanel.overview.ports.loadFailed')}
      <button {...stylex.props(styles.retry)} type={'button'} onClick={() => void refresh()}>
        {tCommon('retry')}
      </button>
    </div>
  );

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div {...stylex.props(styles.state)}>
        <Icon spin icon={LoaderCircleIcon} size={13} />
        {t('workingPanel.overview.ports.loading')}
      </div>
    );
  } else if (listFailed) {
    // "We couldn't ask" must not read as "nothing is open".
    body = loadFailedState;
  } else if (tunnels.length === 0 && detected.length === 0 && detectionChecking) {
    // An empty earlier probe is not "nothing listens": wait for the device.
    body = checkingState;
  } else if (tunnels.length === 0 && detected.length === 0) {
    body = (
      <div {...stylex.props(styles.empty)}>
        {detectionAvailable
          ? t('workingPanel.overview.ports.detected.none')
          : t('workingPanel.overview.ports.unavailable')}
      </div>
    );
  } else {
    body = (
      <>
        {/* A failed refresh keeps the links already known. */}
        {refreshFailed && loadFailedState}
        {tunnels.map(renderLink)}
        {/* Ports from an earlier probe paint while the device is asked again;
            whether they still listen is unknown until it answers. */}
        {detected.length > 0 && detectionChecking && checkingState}
        {detected.map(renderDetected)}
      </>
    );
  }

  return (
    <DropdownMenuRoot open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger>
        <OverviewRow
          interactive
          icon={GlobeIcon}
          value={t('workingPanel.overview.ports.title')}
          trailing={
            <>
              {detected.length > 0 && !detectionChecking && (
                // A running dev server the user hasn't exposed yet — say so
                // without making them open the menu. Ports from an earlier
                // probe are not known to be running, so they wait for the device.
                <span {...stylex.props(styles.available)}>
                  {t('workingPanel.overview.ports.detected.available', { count: detected.length })}
                </span>
              )}
              <PickerGlyph />
            </>
          }
        />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement={'bottomLeft'} sideOffset={8}>
          <DropdownMenuPopup>
            <div {...stylex.props(styles.container)}>
              <div {...stylex.props(styles.header)}>
                {t('workingPanel.overview.ports.title')}
                {/* Kept even when detection is unavailable: a device that just came
                    back online is otherwise stuck on the stale answer. */}
                <Tooltip title={t('workingPanel.overview.ports.detected.refresh')}>
                  <button
                    aria-label={t('workingPanel.overview.ports.detected.refresh')}
                    {...stylex.props(styles.action)}
                    type={'button'}
                    {...ownPress(() => void refreshDetected())}
                  >
                    <Icon icon={RefreshCwIcon} size={12} spin={detectionLoading} />
                  </button>
                </Tooltip>
              </div>

              {body}

              {otherPorts.length > 0 && (
                <>
                  <DropdownMenuItem
                    {...stylex.props(styles.toggle)}
                    closeOnClick={false}
                    onClick={() => setShowOthers((value) => !value)}
                  >
                    {showOthers
                      ? t('workingPanel.overview.ports.detected.hideOthers')
                      : t('workingPanel.overview.ports.detected.others', {
                          count: otherPorts.length,
                        })}
                  </DropdownMenuItem>
                  {showOthers && (
                    <div {...stylex.props(styles.othersList)}>{otherPorts.map(renderDetected)}</div>
                  )}
                </>
              )}
            </div>
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  );
});

PortSwitcher.displayName = 'PortSwitcher';

export default PortSwitcher;
