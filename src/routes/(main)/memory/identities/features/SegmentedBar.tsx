import { Tabs } from '@lobehub/ui/base-ui';
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
    <Tabs
      activeKey={typeValue}
      items={[
        { key: 'all', label: t('identity.filter.type.all') },
        { key: 'personal', label: t('identity.filter.type.personal') },
        { key: 'professional', label: t('identity.filter.type.professional') },
        { key: 'demographic', label: t('identity.filter.type.demographic') },
      ]}
      onChange={(key) => onTypeChange(key as IdentityType)}
    />
  );
});

export default SegmentedBar;
