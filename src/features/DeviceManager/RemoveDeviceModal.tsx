'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Avatar, Checkbox, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, createModal, useModalContext } from '@lobehub/ui/base-ui';
import { Skeleton } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { t } from 'i18next';
import { TriangleAlertIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { lambdaQuery } from '@/libs/trpc/client';

import { refreshDeviceList } from './const';

const styles = createStaticStyles(({ css }) => ({
  agentList: css`
    padding: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  agentRow: css`
    width: 100%;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  footer: css`
    padding-block: 16px;
    padding-inline: 24px;
  `,
  warning: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;
    color: ${cssVar.colorWarningText};

    background: ${cssVar.colorWarningBg};
  `,
}));

interface RemoveWorkspaceDeviceContentProps {
  device: DeviceListItem;
  isCurrent?: boolean;
}

/**
 * Body of the workspace "remove device" modal. Removal is refused server-side
 * while any workspace agent pins this device as its fixed execution target
 * (`DeviceBoundToFixedAgent`), so instead of letting the user dead-end on that
 * error, the modal lists the bound agents up front and asks the user to check
 * off each one — an explicit acknowledgment that those agents fall back to
 * member-choice execution — before a single "Unbind & Remove" action releases
 * the bindings and removes the device in one call.
 *
 * Bindings the caller cannot release themselves (no edit permission on the
 * agent, or another member's private agent, surfaced only as a count) keep the
 * action disabled with an explanation, since removal would be refused anyway.
 */
const RemoveWorkspaceDeviceContent = memo<RemoveWorkspaceDeviceContentProps>(
  ({ device, isCurrent }) => {
    const { t } = useTranslation('setting');
    const { t: tCommon } = useTranslation('common');
    const { close, setCanDismissByClickOutside } = useModalContext();

    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
    const [removing, setRemoving] = useState(false);

    const { data, isLoading } = lambdaQuery.device.getWorkspaceDeviceAgentBindings.useQuery({
      deviceId: device.deviceId,
    });
    const removeDevice = lambdaQuery.device.removeWorkspaceDevice.useMutation();

    const bindings = data?.agents ?? [];
    const hiddenCount = data?.hiddenCount ?? 0;
    const hasBindings = bindings.length > 0 || hiddenCount > 0;
    const lockedCount = hiddenCount + bindings.filter((agent) => !agent.canUnbind).length;
    const allAcknowledged = bindings
      .filter((agent) => agent.canUnbind)
      .every((agent) => selected.has(agent.id));
    const canRemove = !isLoading && lockedCount === 0 && allAcknowledged;

    const toggle = (id: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

    const handleRemove = async () => {
      setRemoving(true);
      // Lock dismissal so the mutation can't be interrupted mid-flight.
      setCanDismissByClickOutside?.(false);
      try {
        // The checked-off agents are a client-side acknowledgment; the server
        // releases every caller-visible binding (a boolean, not an id list, so
        // removal can't dead-end on a wire-schema cap) and still refuses when
        // anything unreleasable remains.
        await removeDevice.mutateAsync({
          deviceId: device.deviceId,
          ...(selected.size > 0 ? { unbindBoundAgents: true } : {}),
        });
        refreshDeviceList();
        close();
      } catch (error) {
        // Server messages (e.g. a binding added by someone else mid-flow) are
        // user-facing — surface them verbatim.
        message.error((error as Error).message);
      } finally {
        setRemoving(false);
        setCanDismissByClickOutside?.(true);
      }
    };

    return (
      <Flexbox>
        <Flexbox gap={16} padding={24}>
          <Text style={{ fontSize: 13 }} type={'secondary'}>
            {t('devices.remove.confirmDesc')}
          </Text>
          {isCurrent && (
            <Text style={{ fontSize: 13 }} type={'warning'}>
              {t('devices.remove.currentSessionWarning')}
            </Text>
          )}

          {isLoading ? (
            <Skeleton active paragraph={{ rows: 2 }} title={false} />
          ) : hasBindings ? (
            <>
              <div className={styles.warning}>
                <Icon icon={TriangleAlertIcon} size={16} style={{ flex: 'none', marginTop: 2 }} />
                <span>{t('devices.remove.boundAgents.desc')}</span>
              </div>

              {bindings.length > 0 && (
                <Flexbox className={styles.agentList} gap={2}>
                  {bindings.map((agent) => (
                    <Checkbox
                      checked={selected.has(agent.id)}
                      classNames={{ wrapper: styles.agentRow }}
                      disabled={!agent.canUnbind || removing}
                      key={agent.id}
                      onChange={() => toggle(agent.id)}
                    >
                      <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                        <Avatar
                          avatar={agent.avatar ?? undefined}
                          background={agent.backgroundColor ?? undefined}
                          size={20}
                        />
                        <Text ellipsis style={{ fontSize: 13 }}>
                          {agent.title || t('devices.remove.boundAgents.untitled')}
                        </Text>
                        {!agent.canUnbind && (
                          <Text style={{ flex: 'none', fontSize: 12 }} type={'secondary'}>
                            {t('devices.remove.boundAgents.noPermission')}
                          </Text>
                        )}
                      </Flexbox>
                    </Checkbox>
                  ))}
                </Flexbox>
              )}

              {hiddenCount > 0 && (
                <Text style={{ fontSize: 12 }} type={'secondary'}>
                  {t('devices.remove.boundAgents.hidden', { count: hiddenCount })}
                </Text>
              )}
            </>
          ) : null}
        </Flexbox>

        <Flexbox horizontal className={styles.footer} gap={8} justify={'space-between'}>
          <Button disabled={removing} onClick={close}>
            {tCommon('cancel')}
          </Button>
          <Button danger disabled={!canRemove} loading={removing} onClick={handleRemove}>
            {t(
              bindings.length > 0
                ? 'devices.remove.boundAgents.unbindAndRemove'
                : 'devices.actions.remove',
            )}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

RemoveWorkspaceDeviceContent.displayName = 'RemoveWorkspaceDeviceContent';

export const openRemoveWorkspaceDeviceModal = (device: DeviceListItem, isCurrent?: boolean) =>
  createModal({
    content: <RemoveWorkspaceDeviceContent device={device} isCurrent={isCurrent} />,
    footer: null,
    maskClosable: false,
    styles: {
      content: { padding: 0 },
    },
    title: t('devices.remove.confirm', { ns: 'setting' }),
    width: 'min(92vw, 480px)',
  });
