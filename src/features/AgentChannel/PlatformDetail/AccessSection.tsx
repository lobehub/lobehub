'use client';

import { confirmModal, Flexbox, Text } from '@lobehub/ui';
import { Form, type FormInstance, useWatch } from '@lobehub/ui/form';
import { memo, type ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { FieldSchema } from '@/server/services/bot/platforms/types';

import {
  type AccessSettings,
  applyDmStance,
  countListed,
  deriveDmStance,
  type DmStance,
  dropHiddenIncompleteRows,
} from './accessStance';
import { ChoiceList, type ChoiceOption } from './ChoiceList';
import type { ChannelFormValues } from './index';
import { SchemaField } from './SchemaField';
import type { AccessSectionKey } from './settingsGroups';

type GroupPolicy = 'allowlist' | 'disabled' | 'open';
type DevicePolicy = 'allowlist' | 'channel' | 'owner';
type DeviceChannelPolicy = 'allowlist' | 'any';

interface AccessSectionProps {
  disabled?: boolean;
  /** The access fields the platform declares; only ones present are shown. */
  fields: FieldSchema[];
  form: FormInstance<ChannelFormValues>;
  onValuesChange?: (values: ChannelFormValues) => void;
  /** Which block of the access tab to render. */
  section: AccessSectionKey;
  /** Platform helper rendered right under the owner ID field (e.g. Feishu's lookup). */
  userIdExtras?: ReactNode;
}

/**
 * "Who can use it", asked as decisions instead of settings, one block at a time:
 * who the owner is, who may talk to the bot, and who may use the owner's devices.
 *
 * The runtime decides conversation access with `dmPolicy`, a global people list
 * (`allowFrom`), a group policy and a group list. This section lets a person
 * choose one stance per surface and only then shows what that choice needs: the
 * list for "approval" and "listed", the owner's ID for approving. Devices are
 * the owner's alone unless they name people in `deviceAllowFrom` or grant whole
 * channels (`devicePolicy: 'channel'`), and can otherwise be limited to the
 * channels in `deviceChannelAllowFrom`. A list stays mounted
 * when hidden so a saved list is never dropped by a save.
 */
export const AccessSection = memo<AccessSectionProps>(
  ({ disabled, fields, form, onValuesChange, section, userIdExtras }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string, options?: Record<string, unknown>) => string;

    const byKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);
    const watched = useWatch(form, (values) => values.settings);
    const settings = useMemo(() => (watched ?? {}) as AccessSettings, [watched]);

    const stance = deriveDmStance(settings);
    const groupPolicy = (settings.groupPolicy as GroupPolicy | undefined) ?? 'open';
    // Granting whole channels needs the channel list, which only platforms with
    // group chat declare; elsewhere the option is not offered.
    const canGrantChannels = byKey.has('deviceChannelAllowFrom');
    const devicePolicy: DevicePolicy =
      settings.devicePolicy === 'allowlist' ||
      (settings.devicePolicy === 'channel' && canGrantChannels)
        ? settings.devicePolicy
        : 'owner';
    const channelGrant = devicePolicy === 'channel';
    const deviceChannelPolicy: DeviceChannelPolicy =
      settings.deviceChannelPolicy === 'allowlist' ? 'allowlist' : 'any';
    const hasPeopleList = countListed(settings.allowFrom) > 0;

    const write = useCallback(
      (patch: Record<string, unknown>) => {
        const current = (form.getValues().settings ?? {}) as Record<string, unknown>;
        const next = { ...current, ...patch };
        // A list this choice hides must not keep a half-added row: its hidden
        // "ID required" error would block every save.
        Object.assign(next, dropHiddenIncompleteRows(next));
        form.setValues({ settings: next as Record<string, {} | undefined> });
        onValuesChange?.(form.getValues());
      },
      [form, onValuesChange],
    );

    const handleStance = useCallback(
      (next: DmStance) => {
        if (next === stance) return;
        const { dropped, patch } = applyDmStance(next, settings);

        // Switching to "everyone" has to empty the list, or the list would keep
        // restricting everyone. Say so before throwing people off it.
        if (dropped > 0) {
          confirmModal({
            content: t('channel.access.list.clearContent', { count: dropped }),
            okText: t('channel.access.list.clearOk'),
            onOk: () => write(patch),
            title: t('channel.access.list.clearTitle'),
          });
          return;
        }

        write(patch);
      },
      [settings, stance, t, write],
    );

    const handleDevicePolicy = useCallback(
      (next: DevicePolicy) => {
        if (next === devicePolicy) return;
        // Channels already saved on the list, whether they limited device use or
        // sat hidden after "Any channel", would start granting every member of
        // those channels. Say so before they change meaning.
        const savedChannels = countListed(settings.deviceChannelAllowFrom);
        if (next === 'channel' && savedChannels > 0) {
          confirmModal({
            content: t('channel.access.device.grantConfirmContent', { count: savedChannels }),
            okText: t('channel.access.device.grantConfirmOk'),
            onOk: () => write({ devicePolicy: next }),
            title: t('channel.access.device.grantConfirmTitle'),
          });
          return;
        }

        write({ devicePolicy: next });
      },
      [devicePolicy, settings, t, write],
    );

    // Each option states what it does, so the choice is made by reading the
    // options rather than by opening one.
    const dmOptions: ChoiceOption<DmStance>[] = (
      ['everyone', 'approval', 'listed', 'closed'] as const
    ).map((value) => ({
      desc: t(`channel.access.dm.${value}Desc`),
      label: t(`channel.access.dm.${value}`),
      recommendedLabel: value === 'approval' ? t('channel.access.recommended') : undefined,
      value,
    }));
    const deviceValues: DevicePolicy[] = canGrantChannels
      ? ['owner', 'allowlist', 'channel']
      : ['owner', 'allowlist'];
    const deviceOptions: ChoiceOption<DevicePolicy>[] = deviceValues.map((value) => {
      // `channel.access.device.channel.*` already names the "where" block.
      const key = value === 'channel' ? 'channelMembers' : value;
      return {
        desc: t(`channel.access.device.${key}Desc`),
        label: t(`channel.access.device.${key}`),
        recommendedLabel: value === 'owner' ? t('channel.access.recommended') : undefined,
        value,
      };
    });
    const deviceChannelOptions: ChoiceOption<DeviceChannelPolicy>[] = (
      ['any', 'allowlist'] as const
    ).map((value) => ({
      desc: t(`channel.access.device.channel.${value}Desc`),
      label: t(`channel.access.device.channel.${value}`),
      value,
    }));
    const groupOptions: ChoiceOption<GroupPolicy>[] = (
      ['open', 'allowlist', 'disabled'] as const
    ).map((value) => ({
      desc: t(`channel.access.group.${value}Desc`),
      label: t(`channel.access.group.${value}`),
      value,
    }));

    const userId = byKey.get('userId');
    const serverId = byKey.get('serverId');
    const allowFrom = byKey.get('allowFrom');
    const guestPolicy = byKey.get('guestPolicy');
    const groupAllowFrom = byKey.get('groupAllowFrom');
    const deviceAllowFrom = byKey.get('deviceAllowFrom');
    const deviceChannelAllowFrom = byKey.get('deviceChannelAllowFrom');

    const ownerMissing = !(typeof settings.userId === 'string' && settings.userId.trim());
    const approverMissing = settings.dmPolicy === 'pairing' && ownerMissing;
    // A filled list limits everyone in every surface, so it stays visible (and
    // clearable) whatever the DM stance is.
    const listVisible = stance === 'approval' || stance === 'listed' || hasPeopleList;

    if (section === 'identity')
      return (
        <>
          {userId && (
            <SchemaField
              disabled={disabled}
              field={userId}
              parentKey="settings"
              descOverride={
                <>
                  {t('channel.access.identity.desc')}
                  {approverMissing && (
                    <Text fontSize={12} style={{ display: 'block' }} type={'warning'}>
                      {t('channel.access.identity.approverMissing')}
                    </Text>
                  )}
                </>
              }
              validateOverride={() =>
                form.getValue('settings.dmPolicy') === 'pairing' &&
                !String(form.getValue('settings.userId') ?? '').trim()
                  ? t('channel.access.identity.required')
                  : undefined
              }
            />
          )}
          {userIdExtras}
          {/* Your server sits with your own ID: both say what is yours, not who may talk. */}
          {serverId && (
            <SchemaField divider disabled={disabled} field={serverId} parentKey="settings" />
          )}
        </>
      );

    if (section === 'device')
      return (
        <>
          {byKey.has('devicePolicy') && (
            <Form.Field
              label={t('channel.access.device.label')}
              layout="vertical"
              desc={
                ownerMissing ? (
                  <Text fontSize={12} type={'warning'}>
                    {t(
                      channelGrant
                        ? 'channel.access.device.ownerMissingChannel'
                        : 'channel.access.device.ownerMissing',
                    )}
                  </Text>
                ) : undefined
              }
            >
              <Flexbox gap={8}>
                <ChoiceList
                  aria-label={t('channel.access.device.label')}
                  disabled={disabled}
                  options={deviceOptions}
                  value={devicePolicy}
                  onChange={handleDevicePolicy}
                />
                {channelGrant && (
                  <Text fontSize={12} type={'warning'}>
                    {t('channel.access.device.channelMembersRisk')}
                  </Text>
                )}
              </Flexbox>
            </Form.Field>
          )}
          {deviceAllowFrom && (
            <SchemaField
              divider
              descOverride={t('channel.access.device.listHint')}
              disabled={disabled}
              emptyOverride={t('channel.access.device.listEmpty')}
              field={deviceAllowFrom}
              hidden={devicePolicy !== 'allowlist'}
              labelOverride={t('channel.access.device.list')}
              parentKey="settings"
            />
          )}
          {byKey.has('deviceChannelPolicy') && !channelGrant && (
            <Form.Field divider label={t('channel.access.device.channel.label')} layout="vertical">
              <ChoiceList
                aria-label={t('channel.access.device.channel.label')}
                disabled={disabled}
                options={deviceChannelOptions}
                value={deviceChannelPolicy}
                onChange={(next) => write({ deviceChannelPolicy: next })}
              />
            </Form.Field>
          )}
          {deviceChannelAllowFrom && (
            <SchemaField
              divider
              disabled={disabled}
              field={deviceChannelAllowFrom}
              hidden={!channelGrant && deviceChannelPolicy !== 'allowlist'}
              labelOverride={t('channel.access.device.channel.list')}
              parentKey="settings"
              descOverride={t(
                channelGrant
                  ? 'channel.access.device.grant.listHint'
                  : 'channel.access.device.channel.listHint',
              )}
              emptyOverride={t(
                channelGrant
                  ? 'channel.access.device.grant.listEmpty'
                  : 'channel.access.device.channel.listEmpty',
              )}
            />
          )}
        </>
      );

    return (
      <>
        {byKey.has('dmPolicy') && (
          <Form.Field label={t('channel.access.dm.label')} layout="vertical">
            <ChoiceList
              aria-label={t('channel.access.dm.label')}
              disabled={disabled}
              options={dmOptions}
              value={stance}
              onChange={handleStance}
            />
          </Form.Field>
        )}
        {allowFrom && (
          <SchemaField
            divider
            descOverride={t('channel.access.list.hint')}
            disabled={disabled}
            field={allowFrom}
            hidden={!listVisible}
            parentKey="settings"
            emptyOverride={t(
              stance === 'approval'
                ? 'channel.access.list.emptyApproval'
                : 'channel.access.list.emptyListed',
            )}
            labelOverride={t(
              stance === 'approval' ? 'channel.access.list.approved' : 'channel.access.list.listed',
            )}
          />
        )}
        {guestPolicy && (
          <SchemaField divider disabled={disabled} field={guestPolicy} parentKey="settings" />
        )}

        {byKey.has('groupPolicy') && (
          <Form.Field
            divider
            desc={hasPeopleList ? t('channel.access.group.listNote') : undefined}
            label={t('channel.access.group.label')}
            layout="vertical"
          >
            <ChoiceList
              aria-label={t('channel.access.group.label')}
              disabled={disabled}
              options={groupOptions}
              value={groupPolicy}
              onChange={(next) => write({ groupPolicy: next })}
            />
          </Form.Field>
        )}
        {groupAllowFrom && (
          <SchemaField
            divider
            disabled={disabled}
            field={{ ...groupAllowFrom, visibleWhen: undefined }}
            hidden={groupPolicy !== 'allowlist'}
            parentKey="settings"
          />
        )}
      </>
    );
  },
);

AccessSection.displayName = 'ChannelAccessSection';
