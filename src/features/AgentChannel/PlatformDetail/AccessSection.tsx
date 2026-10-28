'use client';

import { confirmModal, Text } from '@lobehub/ui';
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
type DevicePolicy = 'allowlist' | 'owner';

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
 * the owner's alone unless they name people in `deviceAllowFrom`. A list stays
 * mounted when hidden so a saved list is never dropped by a save.
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
    const devicePolicy: DevicePolicy =
      settings.devicePolicy === 'allowlist' ? 'allowlist' : 'owner';
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
    const deviceOptions: ChoiceOption<DevicePolicy>[] = (['owner', 'allowlist'] as const).map(
      (value) => ({
        desc: t(`channel.access.device.${value}Desc`),
        label: t(`channel.access.device.${value}`),
        recommendedLabel: value === 'owner' ? t('channel.access.recommended') : undefined,
        value,
      }),
    );
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
                    {t('channel.access.device.ownerMissing')}
                  </Text>
                ) : undefined
              }
            >
              <ChoiceList
                aria-label={t('channel.access.device.label')}
                disabled={disabled}
                options={deviceOptions}
                value={devicePolicy}
                onChange={(next) => write({ devicePolicy: next })}
              />
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
