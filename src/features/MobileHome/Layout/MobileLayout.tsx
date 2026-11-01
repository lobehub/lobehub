import { type PropsWithChildren } from 'react';

import MobileContentLayout from '@/components/server/MobileNavLayout';

import { styles } from './MobileLayout/style';
import SessionHeader from './SessionHeader';
import SessionSearchBar from './SessionSearchBar';

const MobileLayout = ({ children }: PropsWithChildren) => {
  return (
    <MobileContentLayout withNav header={<SessionHeader />}>
      <div className={styles.searchBarContainer}>
        <SessionSearchBar mobile />
      </div>
      {children}
    </MobileContentLayout>
  );
};

export default MobileLayout;
