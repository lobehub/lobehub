import { type EmptyProps } from '@lobehub/ui';
import { Center, Empty as EmptyComponent } from '@lobehub/ui';
import { BlocksIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AddSkillButton from './AddSkillButton';

interface SkillEmptyProps extends Omit<EmptyProps, 'icon'> {
  search?: boolean;
}

const Empty = memo<SkillEmptyProps>(({ search, ...rest }) => {
  const { t } = useTranslation('setting');

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <EmptyComponent
        action={!search && <AddSkillButton />}
        description={search ? t('skillStore.emptySearch') : t('skillStore.empty')}
        icon={BlocksIcon}
        descriptionProps={{
          fontSize: 14,
        }}
        style={{
          maxWidth: 400,
        }}
        {...rest}
      />
    </Center>
  );
});

Empty.displayName = 'SkillEmpty';

export default Empty;
