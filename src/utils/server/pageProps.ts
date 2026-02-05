import { translation } from '@/server/translation';
import type {DynamicLayoutProps} from '@/types/next';

import { RouteVariants } from './routeVariants';

export const parsePageMetaProps = async (props: DynamicLayoutProps) => {
  const { locale: hl, isMobile } = await RouteVariants.getVariantsFromProps(props);
  const { t, locale } = await translation('metadata', hl);
  return { isMobile, locale, t };
};
