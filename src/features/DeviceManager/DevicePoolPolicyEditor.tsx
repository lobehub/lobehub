import type {
  DevicePoolMatrix,
  DevicePoolPolicy,
  DevicePoolSubject,
  DeviceScope,
} from '@lobechat/types';
import { devicePoolTriggers } from '@lobechat/types';
import { evaluateDevicePoolUse } from '@lobechat/utils/devicePoolPolicy';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Select, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Plus, Trash2Icon } from 'lucide-react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import {
  isPanelLayerMotionDisabled,
  panelSlideMotionVariantsLeft,
} from '@/utils/motion/panelSlideMotion';

import { DevicePoolPermissionToggle } from './DevicePoolPermissionToggle';

const styles = createStaticStyles(({ css, cssVar }) => ({
  addPersonLabel: css`
    &[data-placeholder] {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  // NOTICE:
  // Enforce live OS preference changes even while the Motion animation is running.
  // Motion 12.43.0's useReducedMotion snapshots its initial value instead of subscribing React.
  // Source: framer-motion/dist/es/utils/reduced-motion/use-reduced-motion.mjs.
  // Remove when that hook updates reactively and interrupts active animations.
  content: css`
    @media (prefers-reduced-motion: reduce) {
      transform: none !important;
      opacity: 1 !important;
    }
  `,
  layout: css`
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 24px;

    @media (width <= 700px) {
      grid-template-columns: 1fr;
      gap: 20px;
    }
  `,
  identity: css`
    justify-content: flex-start;

    &[aria-pressed='true'] {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  row: css`
    padding-block: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

/** Identity-specific entry rules and their effective result within one pool. */
interface DevicePoolPolicyEditorProps {
  /** Prevent edits while saving or when policy management is unavailable. */
  disabled?: boolean;
  /** Receives the full matrix, preserving the other identities' edits. */
  onChange: (value: DevicePoolMatrix) => void;
  /** Whether the edited matrix is an Agent override. @default false */
  override?: boolean;
  /** Current workspace members available for explicit overrides. */
  people?: { id: string; name: string | null; username: string | null }[];
  /** Pool defaults and hard restrictions used for the result explanation. */
  policy: DevicePoolPolicy;
  /** Personal scope omits Workspace member. */
  scope: DeviceScope;
  /** Current editable rules. */
  value: DevicePoolMatrix;
}

/**
 * Selects one identity and edits its Chat, Bot and Task permissions.
 *
 * Use when:
 * - Configuring a pool or one Agent's override
 *
 * Expects:
 * - Identity membership is resolved for the caller, not the pool creator
 *
 * Returns:
 * - A responsive identity list and explained three-state entry controls
 */
export function DevicePoolPolicyEditor({
  disabled,
  people = [],
  override = false,
  value,
  policy,
  scope,
  onChange,
}: DevicePoolPolicyEditorProps) {
  const { t } = useTranslation('setting');
  const animationMode = useUserStore(userGeneralSettingsSelectors.animationMode);
  const reducedMotion = useReducedMotion();
  const animate = !reducedMotion && !isPanelLayerMotionDisabled(animationMode);
  const [personPickerOpen, setPersonPickerOpen] = useState(false);
  const [selected, setSelected] = useState<DevicePoolSubject>(
    scope === 'workspace' ? 'workspaceMember' : 'everyone',
  );
  const named = [...new Set(Object.values(value).flatMap((row) => Object.keys(row ?? {})))].filter(
    (key): key is `user:${string}` => key.startsWith('user:'),
  );
  const subjects: DevicePoolSubject[] =
    scope === 'workspace' ? ['workspaceMember', 'everyone', ...named] : ['everyone'];
  const subject = subjects.includes(selected) ? selected : subjects[0];
  const person = people.find((item) => `user:${item.id}` === subject);
  const subjectLabel = subject.startsWith('user:')
    ? person?.name || person?.username || subject.slice(5)
    : t(
        subject === 'workspaceMember'
          ? 'devicePools.subject.workspaceMember'
          : 'devicePools.subject.everyone',
      );
  const matches: DevicePoolSubject[] = subject.startsWith('user:')
    ? [subject, 'workspaceMember', 'everyone']
    : subject === 'workspaceMember'
      ? ['workspaceMember', 'everyone']
      : ['everyone'];
  return (
    <div className={styles.layout}>
      <Flexbox aria-label={t('devicePools.identity')} gap={8} role="group">
        <Text type="secondary" weight={500}>
          {t('devicePools.identity')}
        </Text>
        {subjects.map((identity) => (
          <Button
            aria-pressed={subject === identity}
            className={styles.identity}
            key={identity}
            type="text"
            onClick={() => setSelected(identity)}
          >
            {identity.startsWith('user:')
              ? people.find((item) => `user:${item.id}` === identity)?.name ||
                people.find((item) => `user:${item.id}` === identity)?.username ||
                identity.slice(5)
              : t(
                  identity === 'workspaceMember'
                    ? 'devicePools.subject.workspaceMember'
                    : 'devicePools.subject.everyone',
                )}
          </Button>
        ))}
        {scope === 'workspace' && (
          <Select
            showSearch
            aria-label={t('devicePools.addPerson')}
            classNames={{ value: styles.addPersonLabel }}
            disabled={disabled}
            open={personPickerOpen}
            placeholder={t('devicePools.addPerson')}
            popupMatchSelectWidth={280}
            prefix={Plus}
            suffixIcon={null}
            value={null}
            variant="borderless"
            options={people
              .filter((person) => !named.includes(`user:${person.id}`))
              .map((person) => ({
                value: person.id,
                label: person.name || person.username || person.id,
              }))}
            onOpenChange={setPersonPickerOpen}
            onSelect={(id) => {
              setPersonPickerOpen(false);
              const key: DevicePoolSubject = `user:${id}`;
              setSelected(key);
              onChange({ ...value, chat: { ...value.chat, [key]: 'inherit' } });
            }}
          />
        )}
      </Flexbox>
      <AnimatePresence initial={false}>
        <m.div
          animate={panelSlideMotionVariantsLeft.animate}
          className={styles.content}
          custom={1}
          initial={animate ? 'initial' : false}
          key={subject}
          variants={panelSlideMotionVariantsLeft}
          transition={{
            ...panelSlideMotionVariantsLeft.transition,
            duration: animate ? (animationMode === 'agile' ? 0.14 : 0.28) : 0,
          }}
        >
          <Flexbox>
            <Flexbox horizontal align="center" justify="space-between">
              <Text fontSize={18} weight={600}>
                {subjectLabel}
              </Text>
              {subject.startsWith('user:') && (
                <ActionIcon
                  danger
                  aria-label={t('devicePools.removePerson')}
                  disabled={disabled}
                  icon={Trash2Icon}
                  style={{ color: cssVar.colorError }}
                  title={t('devicePools.removePerson')}
                  onClick={() => {
                    const next = { ...value };
                    for (const trigger of devicePoolTriggers) {
                      const row = { ...next[trigger] };
                      delete row[subject];
                      next[trigger] = row;
                    }
                    onChange(next);
                  }}
                />
              )}
            </Flexbox>
            <Text type="secondary">
              {t(
                subject.startsWith('user:')
                  ? 'devicePools.personHelp'
                  : subject === 'workspaceMember'
                    ? 'devicePools.subjectHelp.workspaceMember'
                    : 'devicePools.subjectHelp.everyone',
              )}
            </Text>
            {devicePoolTriggers.map((trigger) => {
              const decision = evaluateDevicePoolUse({
                policy: override ? policy : { ...policy, rules: value },
                override: override ? value : undefined,
                subjects: matches,
                trigger,
              });
              return (
                <Flexbox className={styles.row} gap={10} key={trigger}>
                  <Flexbox horizontal align="center" gap={20} justify="space-between">
                    <Text weight={500}>{t(`devicePools.permissionTitle.${trigger}`)}</Text>
                    <DevicePoolPermissionToggle
                      disabled={disabled}
                      label={`${subjectLabel} · ${t(`devicePools.trigger.${trigger}`)}`}
                      value={value[trigger]?.[subject] ?? 'inherit'}
                      onChange={(effect) =>
                        onChange({ ...value, [trigger]: { ...value[trigger], [subject]: effect } })
                      }
                    />
                  </Flexbox>
                  <Text type="secondary">{t(`devicePools.triggerHelp.${trigger}`)}</Text>
                  <Text fontSize={12} type="secondary">
                    {t('devicePools.effectiveResult', {
                      result: t(`devicePools.effect.${decision.allowed ? 'allow' : 'deny'}`),
                      source: t(`devicePools.source.${decision.source}`),
                    })}
                  </Text>
                </Flexbox>
              );
            })}
            <Text style={{ paddingTop: 16 }} type="secondary">
              {t(override ? 'devicePools.overrideInheritance' : 'devicePools.inheritance')}
            </Text>
          </Flexbox>
        </m.div>
      </AnimatePresence>
    </div>
  );
}
