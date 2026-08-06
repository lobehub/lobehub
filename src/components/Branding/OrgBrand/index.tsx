import { getLocalizedOrgName } from '@lobechat/business-const';
import { type LobeHubProps } from '@lobehub/ui/brand';
import { LobeHub } from '@lobehub/ui/brand';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isCustomORG } from '@/const/version';

export const OrgBrand = memo<LobeHubProps>((props) => {
  const { i18n } = useTranslation();

  if (isCustomORG) {
    return <span>{getLocalizedOrgName(i18n.language)}</span>;
  }

  return <LobeHub {...props} />;
});
