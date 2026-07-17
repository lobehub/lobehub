'use client';

import { getComposioAppByIdentifier } from '@lobechat/const';
import { Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { RefreshCwIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';

import AppRow from '../../ConnectApps/AppRow';
import { styles } from './style';
import { useSubmitSupplement } from './useSubmitSupplement';

const APP_DESCRIPTION_KEYS = {
  'google-calendar': 'flow.steps.connectApps.apps.googleCalendar.description',
  'notion': 'flow.steps.connectApps.apps.notion.description',
  'twitter': 'flow.steps.connectApps.apps.twitter.description',
} as const;

const APP_IDENTIFIERS = Object.keys(APP_DESCRIPTION_KEYS) as (keyof typeof APP_DESCRIPTION_KEYS)[];

const SupplementForm = () => {
  const { t } = useTranslation('onboarding');
  const { close } = useModalContext();
  const [text, setText] = useState('');
  const { submit, submitting } = useSubmitSupplement(close);

  const useFetchUserComposioConnections = useToolStore((s) => s.useFetchUserComposioConnections);
  useFetchUserComposioConnections(true);

  const apps = useMemo(
    () =>
      APP_IDENTIFIERS.map((identifier) => getComposioAppByIdentifier(identifier)).filter(
        (app) => app !== undefined,
      ),
    [],
  );

  return (
    <Flexbox className={styles.container} gap={16}>
      <Text className={styles.description}>
        {t('flow.steps.profile.supplementModal.description')}
      </Text>
      <Flexbox gap={8}>
        <Text className={styles.sectionLabel}>
          {t('flow.steps.profile.supplementModal.aboutYou')}
        </Text>
        <TextArea
          autoSize={{ maxRows: 8, minRows: 3 }}
          placeholder={t('flow.steps.profile.supplementModal.placeholder')}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Flexbox>
      <Flexbox gap={4}>
        {apps.map((app) => (
          <AppRow
            app={app}
            key={app.identifier}
            description={t(
              APP_DESCRIPTION_KEYS[app.identifier as keyof typeof APP_DESCRIPTION_KEYS],
            )}
          />
        ))}
      </Flexbox>
      <Flexbox horizontal justify={'flex-end'}>
        <Button
          disabled={!text.trim()}
          icon={RefreshCwIcon}
          iconPosition={'end'}
          loading={submitting}
          shape={'round'}
          type={'primary'}
          onClick={() => submit(text)}
        >
          {t('flow.steps.profile.supplementModal.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export default SupplementForm;
