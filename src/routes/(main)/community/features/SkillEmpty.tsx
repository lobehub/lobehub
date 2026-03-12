import { type EmptyProps } from '@lobehub/ui';
import { Center, Empty } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface SkillEmptyProps extends Omit<EmptyProps, 'icon'> {
  search?: boolean;
}

const SkillEmpty = memo<SkillEmptyProps>(({ search, ...rest }) => {
  const { t } = useTranslation('discover');

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <Empty
        description={search ? t('skillEmpty.search') : t('skillEmpty.description')}
        icon={SkillsIcon}
        title={search ? undefined : t('skillEmpty.title')}
        type={search ? 'default' : 'page'}
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

SkillEmpty.displayName = 'SkillEmpty';

export default SkillEmpty;
