import { BRANDING_NAME } from '@lobechat/business-const';
import { memo, useEffect } from 'react';

const PageTitle = memo<{ title: string }>(({ title }) => {
  useEffect(() => {
    document.title = title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME;
  }, [title]);

  return null;
});

export default PageTitle;
