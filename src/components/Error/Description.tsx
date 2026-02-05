'use client';

import { Flexbox, Highlighter, Icon } from '@lobehub/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const Description = memo<{ message: string; status: number }>(({ message, status }) => {
  const { t } = useTranslation('error');
  const [show, setShow] = useState(false);
  return (
    <Flexbox gap={8}>
      {t(`response.${status}` as any)}
      <Flexbox
        horizontal
        gap={4}
        style={{ cursor: 'pointer', fontSize: 12 }}
        onClick={() => {
          setShow(!show);
        }}
      >
        {t('fetchError.detail')} <Icon icon={show ? ChevronUp : ChevronDown} />
      </Flexbox>
      <Highlighter language={'text'} style={{ display: show ? undefined : 'none', maxHeight: 80 }}>
        {message}
      </Highlighter>
    </Flexbox>
  );
});

export default Description;
