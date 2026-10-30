'use client';

import { Button, confirmModal, Flexbox, Text } from '@lobehub/ui';
import { Form, type FormInstance } from '@lobehub/ui/form';
import { RotateCcw } from 'lucide-react';
import { Fragment, memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  FieldSchema,
  SerializedPlatformDefinition,
} from '@/server/services/bot/platforms/types';
import { useServerConfigStore } from '@/store/serverConfig';

import {
  platformCredentialBodyMap,
  platformCredentialExtrasMap,
  platformSettingsFieldExtrasMap,
  platformWakeNoticeMap,
} from '../platform/registry';
import { getInlineFieldKeys } from '../quickSetup/guides';
import QuickSetupSection from '../quickSetup/QuickSetupSection';
import { WakeRecords } from '../WakeRecords';
import { AccessSection } from './AccessSection';
import styles from './Body.module.css';
import type { ChannelTab } from './channelTabs';
import { extractSettingsDefaults, WAKE_MASTER_KEY } from './formState';
import type { ChannelFormValues } from './index';
import { ModuleSaveBar } from './ModuleSaveBar';
import type { SaveModuleId } from './saveModules';
import { ApplicationIdField, SchemaField } from './SchemaField';
import {
  getSchemaFields,
  groupAccessFields,
  groupReplyFields,
  groupSettingsFields,
  groupWakeFields,
  WAKE_KEY_PREFIX,
} from './settingsGroups';

/**
 * What the page hands the body so each block can show its own Save: which blocks exist, which
 * hold unsaved changes, and which one is being saved. Absent while a bot is still being created,
 * when the setup steps save everything at once.
 */
export interface ModuleControls {
  dirty: readonly SaveModuleId[];
  ids: readonly SaveModuleId[];
  onDiscard: (id: SaveModuleId) => void;
  onSave: (id: SaveModuleId) => void;
  saving?: SaveModuleId;
}

/** The wake blocks that say, under their title, what they are for. */
const WAKE_SECTIONS_WITH_DESC = new Set(['channels', 'judgement', 'pace']);

/**
 * One tab's content. Every panel stays mounted and only the active one is
 * visible, so a field on another tab keeps its value and is still validated
 * and saved with the form.
 */
const Panel = ({
  active,
  children,
  tab,
}: {
  active: boolean;
  children: ReactNode;
  tab: ChannelTab;
}) => (
  <div hidden={!active} id={`channel-panel-${tab}`} role="tabpanel">
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>{children}</div>
  </div>
);

// --------------- Body component ---------------

interface BodyProps {
  /** The tab shown; the others stay mounted but hidden. */
  activeTab: ChannelTab;
  currentConfig?: {
    applicationId: string;
    credentials: Record<string, string>;
    /** The saved bot's id; the wake records tab reads its history by it. */
    id?: string;
    settings?: Record<string, unknown> | null;
  };
  disabled?: boolean;
  form: FormInstance<ChannelFormValues>;
  hasConfig?: boolean;
  /** Per-block save buttons; see {@link ModuleControls}. */
  moduleControls?: ModuleControls;
  /** Saves and connects the credentials; resolves `false` when saving failed. */
  onAuthenticated?: (params: {
    applicationId: string;
    credentials: Record<string, string>;
  }) => Promise<boolean> | void;
  /** Saves and connects the bot; offered as a step of its own while setting one up. */
  onSave?: () => void;
  onValuesChange?: (values: ChannelFormValues) => void;
  platformDef: SerializedPlatformDefinition;
  /** Name a quick-created bot app starts with (the agent's name). */
  quickSetupAppName?: string;
  /** Who a quick-created bot app is for (the agent id); a new scope starts a new scan. */
  quickSetupScope?: string;
  /** A save is running. */
  saving?: boolean;
}

const Body = memo<BodyProps>(
  ({
    activeTab,
    platformDef,
    form,
    hasConfig,
    currentConfig,
    moduleControls,
    onAuthenticated,
    onSave,
    onValuesChange,
    disabled,
    quickSetupAppName,
    saving,
    quickSetupScope,
  }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string) => string;

    // The records tab is a history read, not settings: it mounts the first time it is opened and
    // then stays, so switching tabs keeps its filters and loaded pages.
    const [recordsOpened, setRecordsOpened] = useState(false);
    if (activeTab === 'records' && !recordsOpened) setRecordsOpened(true);

    const CustomCredentialBody = platformCredentialBodyMap[platformDef.id];
    const CredentialExtras = platformCredentialExtrasMap[platformDef.id];
    const WakeNotice = platformWakeNoticeMap[platformDef.id];

    // Fields behind a rollout flag stay hidden until the user's flag is on (and
    // while the flags have not loaded yet).
    const featureFlags = useServerConfigStore((s) => s.featureFlags) as
      Record<string, unknown> | undefined;

    const credentialFields = useMemo(
      () => getSchemaFields(platformDef.schema, 'credentials', featureFlags),
      [platformDef.schema, featureFlags],
    );

    const settingsGroups = useMemo(
      () => groupSettingsFields(getSchemaFields(platformDef.schema, 'settings', featureFlags)),
      [platformDef.schema, featureFlags],
    );

    // While a bot is being set up, its credentials are asked for in the setup
    // step that produces them. A saved bot has no steps on screen, so they sit
    // in the credentials group.
    const inlineKeys = useMemo(
      () => (hasConfig ? new Set<string>() : getInlineFieldKeys(platformDef.id)),
      [hasConfig, platformDef.id],
    );

    const renderStepField = (key: string) => {
      if (key === 'applicationId') {
        const field = platformDef.schema.find((section) => section.key === 'applicationId');
        return field && <ApplicationIdField disabled={disabled} field={field} />;
      }
      if (key === 'extras') return CredentialExtras && <CredentialExtras disabled={disabled} />;
      const field = credentialFields.find((item) => item.key === key);
      return (
        field && <SchemaField fullWidth disabled={disabled} field={field} parentKey="credentials" />
      );
    };

    const groupCredentialFields = credentialFields.filter((field) => !inlineKeys.has(field.key));
    const showExtras = !!CredentialExtras && !inlineKeys.has('extras');
    const showApplicationId =
      !inlineKeys.has('applicationId') &&
      platformDef.schema.some((section) => section.key === 'applicationId');

    const connectGroup = settingsGroups.find((group) => group.key === 'connect');

    // Reset only what the section shows: access rules and reply style are
    // deliberate choices, so a reset button on "Advanced" must not touch them.
    const handleResetGroup = useCallback(
      (fields: FieldSchema[]) => {
        const defaults = extractSettingsDefaults(platformDef.schema);
        const next = { ...form.getValues().settings };
        for (const field of fields) next[field.key] = defaults[field.key] as {} | undefined;

        form.setValues({ settings: next });
        onValuesChange?.(form.getValues());
      },
      [form, onValuesChange, platformDef.schema],
    );

    // A settings-field helper writes straight into the form, which does not
    // fire the Form's `onValuesChange` — same reason `handleResetGroup`
    // reports its own write. Without this the page never sees the change and
    // the unsaved-changes affordances stay hidden.
    const handleFieldExtrasFilled = useCallback(() => {
      onValuesChange?.(form.getValues());
    }, [form, onValuesChange]);

    // A platform's helper that sits under one setting (e.g. Feishu's "fetch my
    // Open ID" under the owner ID).
    const renderExtras = (field?: FieldSchema, featureLocked = false) => {
      if (!field) return null;
      const FieldExtras = platformSettingsFieldExtrasMap[`${platformDef.id}:${field.key}`];
      if (!FieldExtras) return null;

      return (
        <FieldExtras
          disabled={disabled || featureLocked}
          platformId={platformDef.id}
          savedValue={currentConfig?.settings?.[field.key]}
          onFilled={handleFieldExtrasFilled}
        />
      );
    };

    // The Save in the corner of a block, when the page saves that block by itself.
    const moduleExtra = (id: SaveModuleId) =>
      moduleControls?.ids.includes(id) ? (
        <ModuleSaveBar
          dirty={moduleControls.dirty.includes(id)}
          disabled={disabled}
          saving={moduleControls.saving === id}
          onDiscard={() => moduleControls.onDiscard(id)}
          onSave={() => moduleControls.onSave(id)}
        />
      ) : undefined;

    // The fields of one settings block. The master switch is always on for the people who see the
    // wake options, so it is not shown.
    const renderSettingsFields = (fields: FieldSchema[]) =>
      fields
        .filter((field) => field.key !== WAKE_MASTER_KEY)
        .map((field, index) => {
          // Feature-gated fields (e.g. watch keywords) lock when the resolved access meta
          // reports the feature as not allowed.
          const featureLocked =
            !!field.paidFeature &&
            platformDef.access?.features?.[field.paidFeature]?.allowed === false;
          return (
            <Fragment key={field.key}>
              <SchemaField
                disabled={disabled}
                divider={index !== 0}
                featureLocked={featureLocked}
                field={field}
                parentKey="settings"
              />
              {renderExtras(field, featureLocked)}
            </Fragment>
          );
        });

    return (
      <Form
        form={form}
        gap={24}
        itemMinWidth={'max(34%, 240px)'}
        style={{ maxWidth: 1024, padding: '8px 0 24px', width: '100%' }}
        variant={'filled'}
      >
        <Panel active={activeTab === 'connect'} tab="connect">
          {CustomCredentialBody ? (
            <Form.Group title={t('channel.credentials')} variant={'filled'}>
              <CustomCredentialBody
                currentConfig={currentConfig}
                disabled={disabled}
                hasConfig={hasConfig}
                onAuthenticated={onAuthenticated}
              />
            </Form.Group>
          ) : (
            <>
              <QuickSetupSection
                appName={quickSetupAppName || 'LobeHub'}
                disabled={disabled}
                form={form}
                hasConfig={hasConfig}
                platformId={platformDef.id}
                renderField={inlineKeys.size > 0 ? renderStepField : undefined}
                saving={saving}
                scope={quickSetupScope}
                onAuthenticated={onAuthenticated}
                onSave={onSave}
              />
              {/* Credentials of a saved bot are masked and rarely edited, so they
            fold away; a new bot has nothing else to do but fill them in. */}
              {(groupCredentialFields.length > 0 || showApplicationId || showExtras) && (
                <Form.Group
                  className={styles.moduleGroup}
                  collapsible={!!hasConfig || inlineKeys.size > 0}
                  defaultActive={!hasConfig && inlineKeys.size === 0}
                  desc={t('channel.group.credentialsDesc')}
                  extra={moduleExtra('credentials')}
                  keyValue={`credentials-${platformDef.id}`}
                  variant={'filled'}
                  // The steps above ask for what is needed; what is left is optional.
                  title={t(
                    inlineKeys.size > 0
                      ? 'channel.group.credentialsOptional'
                      : 'channel.credentials',
                  )}
                >
                  {/* Render top-level sections in schema order so each platform controls
              its own field ordering. LINE places `credentials` before `applicationId`
              because the operator must enter the channel access token before the
              "Fetch from LINE" button (rendered after applicationId) can auto-fill
              the destination user ID; Discord/Slack/QQ/Feishu place `applicationId`
              first as a primary identifier. */}
                  {platformDef.schema
                    .filter(
                      (section) =>
                        (section.key === 'applicationId' && showApplicationId) ||
                        section.key === 'credentials',
                    )
                    .map((section, sectionIndex) => {
                      const needsDivider = sectionIndex > 0;
                      if (section.key === 'applicationId') {
                        return (
                          <ApplicationIdField
                            disabled={disabled}
                            divider={needsDivider}
                            field={section}
                            key="applicationId"
                          />
                        );
                      }
                      return (
                        <Fragment key="credentials">
                          {groupCredentialFields.map((field, i) => (
                            <SchemaField
                              fullWidth
                              disabled={disabled}
                              divider={needsDivider || i !== 0}
                              field={field}
                              key={field.key}
                              parentKey="credentials"
                            />
                          ))}
                        </Fragment>
                      );
                    })}
                  {/* Platform-specific helpers (e.g. LINE's "Fetch from LINE" button)
              render after the credential + applicationId block so the button
              sits next to the field it acts on. */}
                  {showExtras && <CredentialExtras disabled={disabled} />}
                </Form.Group>
              )}
            </>
          )}
          {connectGroup && (
            <Form.Group
              className={styles.moduleGroup}
              collapsible={false}
              extra={moduleExtra('connection')}
              keyValue={`settings-connect-${platformDef.id}`}
              title={t('channel.group.connection')}
              variant={'filled'}
            >
              {connectGroup.fields.map((field, index) => (
                <SchemaField
                  disabled={disabled}
                  divider={index !== 0}
                  field={field}
                  key={field.key}
                  parentKey="settings"
                />
              ))}
            </Form.Group>
          )}
        </Panel>
        {settingsGroups
          .filter((group) => group.key !== 'connect')
          .map((group) => (
            <Panel active={activeTab === group.key} key={group.key} tab={group.key}>
              {/* The intro explains the rules, so it shows only where they are released. */}
              {group.key === 'wake' &&
                group.fields.some((field) => field.key.startsWith(WAKE_KEY_PREFIX)) && (
                  <Text fontSize={12} type={'secondary'}>
                    {t('channel.wake.intro')}
                  </Text>
                )}
              {group.key === 'wake' && WakeNotice && <WakeNotice />}
              {group.key === 'access' ? (
                // Who the owner is, who may talk to the bot and who may use the owner's devices are
                // three separate decisions, so each gets a block (and a Save) of its own.
                groupAccessFields(group.fields).map((section) => (
                  <Form.Group
                    className={styles.moduleGroup}
                    collapsible={false}
                    extra={moduleExtra(`access-${section.key}`)}
                    key={section.key}
                    keyValue={`settings-access-${section.key}-${platformDef.id}`}
                    title={t(`channel.access.section.${section.key}`)}
                    variant={'filled'}
                    desc={
                      section.key === 'identity'
                        ? undefined
                        : t(`channel.access.section.${section.key}Desc`)
                    }
                  >
                    <AccessSection
                      disabled={disabled}
                      fields={section.fields}
                      form={form}
                      section={section.key}
                      userIdExtras={renderExtras(section.fields.find((f) => f.key === 'userId'))}
                      onValuesChange={onValuesChange}
                    />
                  </Form.Group>
                ))
              ) : group.key === 'reply' ? (
                // How a reply looks saves itself as it changes; how the bot talks is long text, so
                // it is a block of its own with a Save.
                groupReplyFields(group.fields).map((section) => (
                  <Form.Group
                    className={styles.moduleGroup}
                    collapsible={false}
                    extra={section.key === 'style' ? moduleExtra('reply-style') : undefined}
                    key={section.key}
                    keyValue={`settings-reply-${section.key}-${platformDef.id}`}
                    title={t(`channel.reply.section.${section.key}`)}
                    variant={'filled'}
                    desc={
                      section.key === 'display' && hasConfig
                        ? t('channel.reply.instant')
                        : undefined
                    }
                  >
                    {renderSettingsFields(section.fields)}
                  </Form.Group>
                ))
              ) : group.key === 'wake' ? (
                // Keywords, channels, pace and judgement each get a block of their own, so a long
                // list of options reads as four decisions.
                groupWakeFields(group.fields).map((section) => (
                  <Form.Group
                    className={styles.moduleGroup}
                    collapsible={false}
                    extra={moduleExtra(`wake-${section.key}`)}
                    key={section.key}
                    keyValue={`settings-wake-${section.key}-${platformDef.id}`}
                    title={t(`channel.wake.section.${section.key}`)}
                    variant={'filled'}
                    desc={
                      WAKE_SECTIONS_WITH_DESC.has(section.key)
                        ? t(`channel.wake.section.${section.key}Desc`)
                        : undefined
                    }
                  >
                    {renderSettingsFields(section.fields)}
                  </Form.Group>
                ))
              ) : (
                <Form.Group
                  className={styles.moduleGroup}
                  collapsible={false}
                  extra={moduleExtra(group.key as SaveModuleId)}
                  keyValue={`settings-${group.key}-${platformDef.id}`}
                  variant={'filled'}
                  // A block with a Save in its corner needs a header to hold it.
                  title={
                    moduleControls?.ids.includes(group.key as SaveModuleId)
                      ? t(`channel.tab.${group.key}`)
                      : undefined
                  }
                >
                  {renderSettingsFields(group.fields)}
                  {group.key === 'advanced' && (
                    <Flexbox horizontal justify={'flex-end'} style={{ paddingBlock: 8 }}>
                      <Button
                        disabled={disabled}
                        icon={<RotateCcw size={14} />}
                        size="small"
                        type="text"
                        onClick={() =>
                          confirmModal({
                            content: t('channel.settingsResetConfirm'),
                            okText: t('channel.settingsResetDefault'),
                            title: t('channel.settingsResetDefault'),
                            onOk: () => handleResetGroup(group.fields),
                          })
                        }
                      >
                        {t('channel.settingsResetDefault')}
                      </Button>
                    </Flexbox>
                  )}
                </Form.Group>
              )}
            </Panel>
          ))}
        {recordsOpened && currentConfig?.id && (
          <Panel active={activeTab === 'records'} tab="records">
            <WakeRecords botId={currentConfig.id} disabled={disabled} />
          </Panel>
        )}
      </Form>
    );
  },
);

export default Body;
