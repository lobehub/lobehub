'use client';

import { Flexbox } from '@lobehub/ui';
import {
  Button,
  createModal,
  Input,
  ModalFooter,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEnvironmentActions } from './useEnvironmentData';

/**
 * Naming a new environment.
 *
 * A dialog rather than a field parked in the page: creating is one action among
 * several this page offers, and an input sitting in the body reads as a setting
 * you are meant to fill in. The name is the only thing asked for — everything
 * else about an environment is edited once it exists, where the form can
 * explain what each part does.
 */
const CreateEnvironmentContent = memo(() => {
  const { t } = useTranslation('setting');
  const { close } = useModalContext();
  const actions = useEnvironmentActions();

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const trimmed = name.trim();

  const submit = async () => {
    if (!trimmed || creating) return;

    setCreating(true);
    setError(undefined);
    try {
      await actions.createEnvironment({ name: trimmed });
      close();
    } catch (cause) {
      // The one failure the user can act on is a name already taken, and it is
      // fixed by typing a different one — so it belongs next to the field
      // rather than in a toast that outlives the dialog.
      setError(
        (cause as { message?: string })?.message === 'DUPLICATE_ENVIRONMENT_NAME'
          ? t('environments.duplicateName')
          : t('environments.createFailed'),
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Flexbox gap={8} paddingBlock={8} paddingInline={16}>
        <Input
          autoFocus
          placeholder={t('environments.namePlaceholder')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
        {error && (
          <Text fontSize={12} type={'danger'}>
            {error}
          </Text>
        )}
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('environments.cancel')}</Button>
        <Button
          disabled={!trimmed}
          loading={creating}
          type={'primary'}
          onClick={() => void submit()}
        >
          {t('environments.create')}
        </Button>
      </ModalFooter>
    </>
  );
});

CreateEnvironmentContent.displayName = 'CreateEnvironmentContent';

export const openCreateEnvironmentModal = () =>
  createModal({
    content: <CreateEnvironmentContent />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: translate('environments.create', { ns: 'setting' }),
    width: 'min(90vw, 420px)',
  });
