import type { DevicePoolMatrix, DeviceScope } from '@lobechat/types';
import { Flexbox, Form, Icon, Input } from '@lobehub/ui';
import {
  ActionIcon,
  Alert,
  Button,
  confirmModal,
  createModal,
  Tabs,
  Text,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, ChevronRight, Layers, Loader2Icon, Monitor, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE, MAX_WIDTH } from '@/const/layoutTokens';
import { useSaveState } from '@/hooks/useSaveState';
import { mutate } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { devicePoolService } from '@/services/devicePool';
import { useDeviceStore } from '@/store/device';
import { useUserStore } from '@/store/user';
import { saveToast } from '@/store/utils/saveToast';

import { AddPoolDevice } from './AddPoolDevice';
import { refreshDeviceList } from './const';
import { DevicePoolPolicyEditor } from './DevicePoolPolicyEditor';
import { deviceSurfaceStyles } from './deviceSurfaceStyles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  surface: css`
    width: 100%;
    max-width: ${MAX_WIDTH}px;
  `,
  row: css`
    cursor: pointer;

    width: 100%;
    padding: 12px;
    border: 0;
    border-radius: ${cssVar.borderRadius};

    color: inherit;
    text-align: start;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
  tile: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    border-radius: 12px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

type PoolDetail = Awaited<ReturnType<typeof devicePoolService.detail>>;

/** A scope-specific settings surface, optionally focused on a single Agent's grants. */
interface DevicePoolManagerProps {
  /** When present, edit only this Agent's overrides. */
  agentId?: string;
  /** Personal or current workspace scope. */
  scope: DeviceScope;
}

const PoolEditor = ({
  data,
  scope,
  agentId,
  refresh,
  onBack,
}: {
  data: PoolDetail;
  scope: DeviceScope;
  agentId?: string;
  refresh: () => Promise<unknown>;
  onBack: () => void;
}) => {
  const { t } = useTranslation('setting');
  const userId = useUserStore((s) => s.user?.id);
  const [tab, setTab] = useState('devices');
  const [name, setName] = useState(data.name);
  const [policy, setPolicy] = useState(data.policy);
  const [rules, setRules] = useState<DevicePoolMatrix>(
    data.overrides.find((item) => item.agentId === agentId)?.rules ?? {},
  );
  const [pending, setPending] = useState(false);
  const policySave = useSaveState();
  const policyInFlight = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const renameInFlight = useRef(false);
  const [error, setError] = useState<unknown>();
  const save = async (action: () => Promise<unknown>, deleted = false) => {
    setPending(true);
    setError(undefined);
    try {
      await action();
      await mutate(deviceKeys.pools(scope));
      if (!deleted) await refresh();
      else onBack();
      refreshDeviceList();
    } catch (cause) {
      setError(cause);
      if (deleted) throw cause;
    } finally {
      setPending(false);
    }
  };
  // Match profile fields: commit on blur or Enter, with a synchronous duplicate guard.
  const commitName = async () => {
    const nextName = name.trim();
    if (!nextName) {
      setName(data.name);
      return;
    }
    if (nextName === data.name || renameInFlight.current || !data.canManage) return;
    renameInFlight.current = true;
    setRenaming(true);
    try {
      await devicePoolService.update({ id: data.id, name: nextName, scope });
      setName(nextName);
      await Promise.all([mutate(deviceKeys.pools(scope)), refresh()]);
    } catch (cause) {
      saveToast(cause, { retry: () => void commitName() });
    } finally {
      renameInFlight.current = false;
      setRenaming(false);
    }
  };
  const disabled = !data.canManage || pending || renaming || policySave.status === 'saving';
  // Reuse Appearance's save state; serialize writes and roll back rejected edits.
  const commitRules = (nextRules: DevicePoolMatrix | null) => {
    if (!data.canManage || policyInFlight.current) return;
    void policySave.save(async () => {
      policyInFlight.current = true;
      const previousPolicy = policy;
      const previousRules = rules;
      if (agentId) setRules(nextRules ?? {});
      else setPolicy({ ...policy, rules: nextRules ?? {} });
      try {
        if (agentId) {
          await devicePoolService.saveOverride({ scope, id: data.id, agentId, rules: nextRules });
        } else {
          await devicePoolService.update({
            scope,
            id: data.id,
            policy: { ...policy, rules: nextRules ?? {} },
          });
        }
        await Promise.all([mutate(deviceKeys.pools(scope)), refresh()]);
        refreshDeviceList();
      } catch (cause) {
        setPolicy(previousPolicy);
        setRules(previousRules);
        throw cause;
      } finally {
        policyInFlight.current = false;
      }
    });
  };
  const openAddDevice = () =>
    createModal({
      title: t('devicePools.addDevice'),
      footer: null,
      width: 440,
      content: (
        <AddPoolDevice
          poolId={data.id}
          scope={scope}
          devices={data.availableDevices.filter(
            (device) => !data.devices.some((member) => member.id === device.id),
          )}
          onAdded={async () => {
            await Promise.all([mutate(deviceKeys.pools(scope)), refresh()]);
            refreshDeviceList();
          }}
        />
      ),
    });
  return (
    <Flexbox className={styles.surface} gap={20}>
      <Flexbox horizontal align="flex-start" gap={8}>
        <ActionIcon
          aria-label={t('devicePools.back')}
          disabled={pending || policySave.status === 'saving'}
          icon={ArrowLeft}
          size="small"
          title={t('devicePools.back')}
          onClick={onBack}
        />
        <Flexbox gap={4}>
          <Text fontSize={20} weight={600}>
            {data.name}
          </Text>
          <Text fontSize={12} type="secondary">
            {t(data.canManage ? 'devicePools.viewerCreator' : 'devicePools.viewerMember')}
          </Text>
        </Flexbox>
      </Flexbox>
      <Text fontSize={13} type="secondary">
        {agentId ? t('devicePools.overrideHelp') : t('devicePools.managementHelp')}
      </Text>
      {!data.canManage && <Text type="secondary">{t('devicePools.readOnly')}</Text>}
      {error ? <AsyncError error={error} variant="inline" /> : null}
      {!agentId && (
        <Tabs
          activeKey={tab}
          items={[
            { key: 'devices', label: t('devicePools.devicesTab') },
            { key: 'permissions', label: t('devicePools.permissions') },
            { key: 'settings', label: t('devicePools.settings') },
          ]}
          onChange={setTab}
        />
      )}
      <Flexbox className={deviceSurfaceStyles.card} gap={20} paddingBlock={16} paddingInline={20}>
        {!agentId && tab === 'permissions' && (
          <>
            <DevicePoolPolicyEditor
              disabled={disabled}
              people={data.availablePeople}
              policy={policy}
              scope={scope}
              value={policy.rules}
              onChange={commitRules}
            />
          </>
        )}
        {!agentId && tab === 'devices' && (
          <>
            <Flexbox horizontal align="center" justify="space-between">
              <Text weight={500}>{t('devicePools.devices')}</Text>
              <ActionIcon
                aria-label={t('devicePools.addDevice')}
                icon={Plus}
                title={t('devicePools.addDevice')}
                onClick={openAddDevice}
              />
            </Flexbox>

            <Text type="secondary">{t('devicePools.shareHelp')}</Text>
            {data.devices.map((device) => (
              <Flexbox horizontal align="center" gap={16} key={device.id}>
                <div className={styles.tile}>
                  <Monitor size={20} />
                </div>
                <Text style={{ flex: 1 }}>{device.name || device.hostname || device.deviceId}</Text>
                <ActionIcon
                  danger
                  aria-label={t('devicePools.revoke')}
                  disabled={pending || (!data.canManage && userId !== device.userId)}
                  icon={X}
                  size="small"
                  style={{ color: cssVar.colorError }}
                  title={t('devicePools.revoke')}
                  onClick={() =>
                    void save(() =>
                      devicePoolService.removeDevice({ scope, id: data.id, deviceId: device.id }),
                    )
                  }
                />
              </Flexbox>
            ))}
            {data.devices.length === 0 && (
              <Flexbox align="center" gap={16} paddingBlock={32}>
                <div className={styles.tile}>
                  <Monitor size={28} />
                </div>
                <Text fontSize={18} weight={600}>
                  {t('devicePools.noDevices')}
                </Text>
                <Button
                  icon={<Plus size={20} />}
                  size="large"
                  style={{ minWidth: 220, minHeight: 56 }}
                  type="primary"
                  onClick={openAddDevice}
                >
                  {t('devicePools.addDevice')}
                </Button>
              </Flexbox>
            )}
          </>
        )}
        {!agentId && tab === 'settings' && (
          <Flexbox gap={8}>
            <Text weight={500}>{t('devicePools.name')}</Text>
            <Flexbox horizontal align="center" gap={8}>
              <Input
                aria-label={t('devicePools.name')}
                disabled={disabled}
                maxLength={100}
                value={name}
                onBlur={() => void commitName()}
                onChange={(e) => setName(e.target.value)}
                onPressEnter={() => void commitName()}
              />
              {renaming && <Icon spin icon={Loader2Icon} size={16} />}
            </Flexbox>
          </Flexbox>
        )}
        {agentId && (
          <>
            <Flexbox horizontal align="center" justify="space-between">
              <Text>
                {data.overrides.some((item) => item.agentId === agentId)
                  ? t('devicePools.custom')
                  : t('devicePools.synced')}
              </Text>
              <Button
                disabled={disabled || !data.overrides.some((item) => item.agentId === agentId)}
                size="small"
                onClick={() => commitRules(null)}
              >
                {t('devicePools.restore')}
              </Button>
            </Flexbox>
            <DevicePoolPolicyEditor
              override
              disabled={disabled}
              people={data.availablePeople}
              policy={policy}
              scope={scope}
              value={rules}
              onChange={commitRules}
            />
          </>
        )}
        {(agentId || tab === 'permissions') && (
          <>
            {(policy.blockedTriggers.length > 0 || policy.everyone !== 'inherit') && (
              <Alert
                type="warning"
                description={t('devicePools.legacyPolicy', {
                  effect: t(`devicePools.effect.${policy.everyone}`),
                  triggers:
                    policy.blockedTriggers
                      .map((trigger) => t(`devicePools.trigger.${trigger}`))
                      .join(', ') || '—',
                })}
              />
            )}
            <AutoSaveHint
              lastUpdatedTime={policySave.lastSavedAt}
              saveStatus={policySave.status}
              onRetry={policySave.retry}
            />
          </>
        )}
        {!agentId && tab === 'settings' && data.canManage && (
          <Button
            danger
            disabled={pending}
            onClick={() =>
              confirmModal({
                title: t('devicePools.delete'),
                content: t('devicePools.deleteHelp'),
                okButtonProps: { danger: true },
                onOk: () => save(() => devicePoolService.remove({ scope, id: data.id }), true),
              })
            }
          >
            {t('devicePools.delete')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
};

const PoolDetails = ({
  id,
  scope,
  agentId,
  onBack,
}: DevicePoolManagerProps & { id: string; onBack: () => void }) => {
  const useFetch = useDeviceStore((s) => s.useFetchDevicePool);
  const { data, error, isLoading, mutate: refresh } = useFetch(scope, id);
  return (
    <AsyncBoundary data={data} error={error} isLoading={isLoading} onRetry={() => void refresh()}>
      {data && (
        <PoolEditor
          agentId={agentId}
          data={data}
          key={`${data.id}:${agentId ?? ''}`}
          refresh={refresh}
          scope={scope}
          onBack={onBack}
        />
      )}
    </AsyncBoundary>
  );
};

/**
 * Configures pool defaults, owner-authorized memberships, and Agent overrides.
 *
 * Use when:
 * - Rendering device settings or an Agent's device configuration
 *
 * Expects:
 * - The active workspace has resolved before mounting workspace scope
 *
 * Returns:
 * - Persisted settings with loading, error, empty, and pending feedback
 */
export function DevicePoolManager({ scope, agentId }: DevicePoolManagerProps) {
  const { t } = useTranslation('setting');
  const useFetch = useDeviceStore((s) => s.useFetchDevicePools);
  const { data, error, isLoading, mutate: refresh } = useFetch(scope);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<unknown>();
  const selectedId = data?.some((pool) => pool.id === selected) ? selected : undefined;
  const create = async () => {
    setPending(true);
    setSaveError(undefined);
    try {
      const pool = await devicePoolService.create({ name, scope });
      await refresh();
      setSelected(pool.id);
      setName('');
      setCreating(false);
    } catch (cause) {
      setSaveError(cause);
    } finally {
      setPending(false);
    }
  };
  if (selectedId)
    return (
      <PoolDetails
        agentId={agentId}
        id={selectedId}
        scope={scope}
        onBack={() => setSelected(undefined)}
      />
    );
  const createButton = !agentId && (
    <Button
      icon={<Plus size={16} />}
      size={scope === 'workspace' ? undefined : 'small'}
      onClick={() => setCreating(!creating)}
    >
      {t('devicePools.create')}
    </Button>
  );
  const content = (
    <Flexbox gap={2}>
      <Text style={{ padding: '8px 12px' }} type="secondary">
        {t('devicePools.description')}
      </Text>
      {saveError ? <AsyncError error={saveError} variant="inline" /> : null}
      <AsyncBoundary data={data} error={error} isLoading={isLoading} onRetry={() => void refresh()}>
        {!agentId && creating && (
          <Flexbox horizontal gap={8}>
            <Input
              aria-label={t('devicePools.name')}
              placeholder={t('devicePools.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              disabled={!name.trim() || pending}
              loading={pending}
              onClick={() => void create()}
            >
              {t('devicePools.create')}
            </Button>
          </Flexbox>
        )}
        {data?.length === 0 && <Text type="secondary">{t('devicePools.empty')}</Text>}
        {data?.map((pool) => (
          <button
            className={styles.row}
            key={pool.id}
            type="button"
            onClick={() => setSelected(pool.id)}
          >
            <Flexbox horizontal align="center" gap={16}>
              <div className={styles.tile}>
                <Layers size={20} />
              </div>
              <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
                <Text weight={500}>{pool.name}</Text>
                <Text type="secondary">
                  {t('devicePools.deviceCount', { count: pool.deviceCount })}
                  {agentId
                    ? ` · ${pool.overrideAgentIds.includes(agentId) ? t('devicePools.custom') : t('devicePools.synced')}`
                    : ''}
                </Text>
              </Flexbox>
              <ChevronRight size={16} />
            </Flexbox>
          </button>
        ))}
      </AsyncBoundary>
    </Flexbox>
  );
  if (scope === 'workspace') {
    return (
      <Flexbox className={styles.surface} gap={16}>
        <Flexbox horizontal align="center" justify="space-between" style={{ minHeight: 36 }}>
          <Text weight={500}>{t('devicePools.title')}</Text>
          {createButton}
        </Flexbox>
        <Flexbox className={deviceSurfaceStyles.card} padding={4}>
          {content}
        </Flexbox>
      </Flexbox>
    );
  }
  return (
    <Form
      {...FORM_STYLE}
      collapsible={false}
      items={[{ title: t('devicePools.title'), extra: createButton, children: content }]}
      itemsType="group"
      variant="filled"
    />
  );
}
