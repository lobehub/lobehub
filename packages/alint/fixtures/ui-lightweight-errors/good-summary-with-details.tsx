// Fixture: one readable line with the raw details folded behind a toggle.
import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { AlertCircle } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const RunError = memo<{ detail: string; summary: string }>(({ detail, summary }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);

  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align={'center'} gap={6}>
        <Icon icon={AlertCircle} />
        <Text type={'secondary'}>{summary}</Text>
        <Text type={'secondary'} onClick={() => setOpen(!open)}>
          {open ? t('error.hideDetail') : t('error.showDetail')}
        </Text>
      </Flexbox>
      {open && <pre>{detail}</pre>}
    </Flexbox>
  );
});

export default RunError;
