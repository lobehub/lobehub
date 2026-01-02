import { Center, Empty, Highlighter } from '@lobehub/ui';
import { Code } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useLd } from './useHead';

const Ld = memo(() => {
  const { t } = useTranslation('components');
  const ld = useLd();

  if (!ld)
    return (
      <Center height={'80%'}>
        <Empty
          description={t('devTools.metadata.empty')}
          descriptionProps={{ fontSize: 14 }}
          icon={Code}
          style={{ maxWidth: 400 }}
        />
      </Center>
    );

  return (
    <Highlighter language="json" variant={'borderless'}>
      {JSON.stringify(JSON.parse(ld), null, 2)}
    </Highlighter>
  );
});

export default Ld;
