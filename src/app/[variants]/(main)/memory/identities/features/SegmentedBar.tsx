import { Segmented } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type IdentityType } from './List';

interface SegmentedBarProps {
  onTypeChange: (type: IdentityType) => void;
  typeValue: IdentityType;
}

const SegmentedBar = memo<SegmentedBarProps>(({ typeValue, onTypeChange }) => {
  const { t } = useTranslation('memory');

  return (
    <Segmented
      onChange={(value) => onTypeChange(value as IdentityType)}
      options={[
        { label: t('identity.filter.type.all'), value: 'all' },
        { label: t('identity.filter.type.personal'), value: 'personal' },
        { label: t('identity.filter.type.professional'), value: 'professional' },
        { label: t('identity.filter.type.demographic'), value: 'demographic' },
      ]}
      value={typeValue}
    />
  );
});

export default SegmentedBar;
