import * as stylex from '@stylexjs/stylex';
import { type PropsWithChildren } from 'react';

import MobileContentLayout from '@/components/server/MobileNavLayout';

import { styles } from './MobileLayout/style';
import SessionHeader from './SessionHeader';
import SessionSearchBar from './SessionSearchBar';

const MobileLayout = ({ children }: PropsWithChildren) => {
  return (
    <MobileContentLayout withNav header={<SessionHeader />}>
      <div {...stylex.props(styles.searchBarContainer)}>
        <SessionSearchBar mobile />
      </div>
      {children}
    </MobileContentLayout>
  );
};

export default MobileLayout;
