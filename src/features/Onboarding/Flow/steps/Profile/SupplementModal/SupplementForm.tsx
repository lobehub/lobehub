'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSubmitSupplement } from './useSubmitSupplement';

const SupplementForm = () => {
  const { t } = useTranslation('onboarding');
  const { close } = useModalContext();
  const [text, setText] = useState('');
  const { submit, submitting } = useSubmitSupplement(close);

  return (
    <Flexbox gap={16}>
      <TextArea
        autoSize={{ maxRows: 8, minRows: 4 }}
        placeholder={t('flow.steps.profile.supplementModal.placeholder')}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Flexbox horizontal justify={'flex-end'}>
        <Button
          disabled={!text.trim()}
          loading={submitting}
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
