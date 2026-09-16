import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const Title = memo(() => {
  const { t } = useTranslation('chat');

  return <>{t('sandboxWorkspace.panelTitle')}</>;
});

Title.displayName = 'SandboxWorkspaceTitle';

export default Title;
