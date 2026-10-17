// Fixture: inside a section card, "Rename" still swaps the one title for an
// inline input — the section-card carve-out covers whole multi-field forms only.
import { Flexbox } from '@lobehub/ui';
import { Button, Input, Text } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SectionCard from './SectionCard';

interface DatasetCardProps {
  name: string;
  onRename: (name: string) => void;
}

const DatasetCard = memo<DatasetCardProps>(({ name, onRename }) => {
  const { t } = useTranslation('dataset');
  const [renaming, setRenaming] = useState(false);

  return (
    <SectionCard
      extra={<Button onClick={() => setRenaming(true)}>{t('rename')}</Button>}
      title={t('dataset')}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        {renaming ? (
          // alint-expect
          <Input
            autoFocus
            defaultValue={name}
            onBlur={() => setRenaming(false)}
            onPressEnter={(event) => {
              onRename(event.currentTarget.value);
              setRenaming(false);
            }}
          />
        ) : (
          <Text strong>{name}</Text>
        )}
      </Flexbox>
    </SectionCard>
  );
});

export default DatasetCard;
