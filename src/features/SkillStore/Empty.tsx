import { Center, Empty as EmptyComponent, type EmptyProps } from '@lobehub/ui';
import { Plug2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface SkillEmptyProps extends Omit<EmptyProps, 'icon'> {
  search?: boolean;
}

const Empty = memo<SkillEmptyProps>(({ search, ...rest }) => {
  const { t } = useTranslation('setting');

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <EmptyComponent
        description={search ? t('skillStore.emptySearch') : t('skillStore.empty')}
        descriptionProps={{
          fontSize: 14,
        }}
        icon={Plug2}
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
