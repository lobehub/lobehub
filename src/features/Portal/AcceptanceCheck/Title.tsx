import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const Title = memo(() => {
  const { t } = useTranslation('chat');

  return t('taskDetail.acceptance.detailTitle');
});

Title.displayName = 'AcceptanceCheckPortalTitle';

export default Title;
