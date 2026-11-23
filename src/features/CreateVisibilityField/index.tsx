'use client';

import { Flexbox, Icon, Segmented, Text } from '@lobehub/ui';
import { LockIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateVisibility, CreateVisibilityState } from './useCreateVisibility';

export type { CreateVisibility, CreateVisibilityOptions } from './useCreateVisibility';
export { resolveCreateVisibility, useCreateVisibility } from './useCreateVisibility';

interface CreateVisibilityFieldProps {
  state: CreateVisibilityState;
}

/**
 * "Private / Workspace" choice shared by the create-agent form, the connect
 * external agent wizard and the create-group dialog, so all three say the same
 * thing about who can open the result. Renders nothing outside a workspace.
 */
const CreateVisibilityField = memo<CreateVisibilityFieldProps>(({ state }) => {
  const { t } = useTranslation('chat');
  const { canPublish, locked, publishBlockedReason, setValue, show, value } = state;

  if (!show || !value) return null;

  const hint = locked
    ? t(
        value === 'private'
          ? 'createVisibility.inheritedPrivate'
          : 'createVisibility.inheritedPublic',
      )
    : value === 'private'
      ? !canPublish && publishBlockedReason
        ? publishBlockedReason
        : t('createVisibility.privateHint')
      : t('createVisibility.publicHint');

  return (
    <Flexbox gap={6}>
      <Text type={'secondary'}>{t('createVisibility.label')}</Text>
      <Segmented<CreateVisibility>
        block
        disabled={locked}
        value={value}
        options={[
          {
            icon: <Icon icon={LockIcon} />,
            label: t('createVisibility.private'),
            value: 'private',
          },
          {
            disabled: !canPublish,
            icon: <Icon icon={UsersIcon} />,
            label: t('createVisibility.public'),
            title: canPublish ? undefined : publishBlockedReason,
            value: 'public',
          },
        ]}
        onChange={setValue}
      />
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {hint}
      </Text>
    </Flexbox>
  );
});

CreateVisibilityField.displayName = 'CreateVisibilityField';

export default CreateVisibilityField;
