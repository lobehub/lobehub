import type { FC, PropsWithChildren, ReactNode } from 'react';

import type { DynamicLayoutProps } from '@/types/next';
import { RouteVariants } from '@/utils/server/routeVariants';

interface ServerLayoutProps<T> {
  Desktop: FC<T>;
  Mobile: FC<T>;
}

interface ServerLayoutInnerProps extends DynamicLayoutProps {
  children: ReactNode;
}

const ServerLayout =
  <T extends PropsWithChildren>({ Desktop, Mobile }: ServerLayoutProps<T>) =>
  async (props: ServerLayoutInnerProps): Promise<ReactNode> => {
    const { params: paramsPromise, ...res } = props;
    if (!paramsPromise) {
      throw new Error(
        `paramsPromise is required for ServerLayout, please pass params props to ServerLayout`,
      );
    }

    const isMobile = await RouteVariants.getIsMobile(props);

    return isMobile ? <Mobile {...(res as T)} /> : <Desktop {...(res as T)} />;
  };

export default ServerLayout;
