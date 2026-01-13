import { BRANDING_NAME } from '@lobechat/business-const';
import { memo, useEffect } from 'react';

import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';

const PageTitle = memo<{ title: string }>(({ title }) => {
  const setCurrentPageTitle = useElectronStore((s) => s.setCurrentPageTitle);

  useEffect(() => {
    document.title = title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME;

    // Sync title to electron store for navigation history
    if (isDesktop) {
      setCurrentPageTitle(title);
    }
  }, [title, setCurrentPageTitle]);

  return null;
});

export default PageTitle;
