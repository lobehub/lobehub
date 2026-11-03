import { Flexbox } from '@lobehub/ui';
import { type PropsWithChildren } from 'react';

import ProviderMenu from '../../ProviderMenu';
import Container from './Container';
import { styles } from './style';

const Layout = ({
  children,
  onProviderSelect,
}: PropsWithChildren & {
  onProviderSelect: (providerKey: string) => void;
}) => {
  return (
    <Flexbox horizontal className={styles.mainContainer} width={'100%'}>
      <ProviderMenu mobile={false} onProviderSelect={onProviderSelect} />
      <Container>{children}</Container>
    </Flexbox>
  );
};
export default Layout;
