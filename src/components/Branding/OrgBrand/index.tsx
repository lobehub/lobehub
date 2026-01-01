import { ORG_NAME } from '@lobechat/business-const';
import { LobeHub, type LobeHubProps } from '@lobehub/ui/brand';
import { memo } from 'react';

import { isCustomORG } from '@/const/version';

export const OrgBrand = memo<LobeHubProps>((props) => {
  if (isCustomORG) {
    return <span>{ORG_NAME}</span>;
  }

  return <LobeHub {...props} />;
});
