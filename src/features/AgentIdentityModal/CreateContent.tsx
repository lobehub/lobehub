'use client';

import { Button, Center, Flexbox, toast, useModalContext } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import EmojiPicker from '@/components/EmojiPicker';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import IdentityFields from './IdentityFields';
import {
  useCreateAgentIdentityForm,
  type UseCreateAgentIdentityFormOptions,
} from './useCreateAgentIdentityForm';

export type CreateAgentIdentityContentProps = UseCreateAgentIdentityFormOptions;

/**
 * Creating an agent is filling in who it is: avatar on top, then the same
 * identity fields the edit form has. Everything else (prompt, model, skills) is
 * configured on the profile page the new agent opens on.
 */
const CreateAgentIdentityContent = memo<CreateAgentIdentityContentProps>(
  ({ groupId, onCreated, visibility }) => {
    const { t } = useTranslation(['setting', 'common']);
    const { close } = useModalContext();
    const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
    const form = useCreateAgentIdentityForm({
      groupId,
      onCreated: (agentId) => {
        close();
        onCreated(agentId);
      },
      visibility,
    });

    return (
      <Flexbox gap={20} padding={20}>
        <Center>
          <EmojiPicker
            allowUpload
            allowDelete={!!form.avatar}
            loading={form.uploading}
            locale={locale}
            popupProps={{ placement: 'bottom' }}
            shape={'square'}
            size={72}
            value={form.avatar}
            // Same avatar the agent wears everywhere else: without an emoji or
            // image it is the generated character, never a placeholder image.
            customRender={() => (
              <AgentAvatar
                avatar={form.avatar}
                className={'lobe-emoji-picker-avatar'}
                name={form.name}
                size={72}
              />
            )}
            onChange={(avatar) => form.setAvatar(avatar)}
            onDelete={() => form.setAvatar(undefined)}
            onUpload={async (file) => {
              if ((await form.uploadAvatar(file)) === 'tooLarge')
                toast.error(t('settingAgent.avatar.sizeExceeded', { ns: 'setting' }));
            }}
          />
        </Center>
        <IdentityFields
          form={form}
          slugPlaceholder={t('settingAgent.slug.autoPlaceholder', { ns: 'setting' })}
        />
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={form.saving} onClick={() => close()}>
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            disabled={form.saving || form.uploading}
            loading={form.saving}
            type={'primary'}
            onClick={() => {
              void form.submit();
            }}
          >
            {t('settingAgent.identity.create', { ns: 'setting' })}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

export default CreateAgentIdentityContent;
