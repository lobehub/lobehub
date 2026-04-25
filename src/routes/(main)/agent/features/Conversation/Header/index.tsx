'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';

import HeaderActions from './HeaderActions';
import ShareButton from './ShareButton';
import Tags from './Tags';
import ViewSwitcher from './ViewSwitcher';
import WorkingPanelToggle from './WorkingPanelToggle';

const headerStyles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;
    container-name: agent-conv-header;
    container-type: inline-size;
  `,
  leftContent: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;
  `,
  slotCenter: css`
    flex: 0 0 auto !important;
    align-items: center;
    justify-content: center;
    min-width: 0;
  `,
  slotLeft: css`
    overflow: hidden;
    flex: 1 1 0;
    min-width: 0;

    @container agent-conv-header (max-width: 719px) {
      flex: 1 1 auto;
    }
  `,
  slotRight: css`
    flex: 1 1 0;
    min-width: 0;

    @container agent-conv-header (max-width: 719px) {
      flex: 0 0 auto;
    }
  `,
}));

const Header = memo(() => {
  return (
    <div className={headerStyles.container}>
      <NavHeader
        left={
          <Flexbox
            allowShrink
            horizontal
            align={'center'}
            className={headerStyles.leftContent}
            gap={4}
            style={{ backgroundColor: cssVar.colorBgContainer }}
          >
            <Tags />
            <HeaderActions />
          </Flexbox>
        }
        right={
          <Flexbox horizontal align={'center'} style={{ backgroundColor: cssVar.colorBgContainer }}>
            <ShareButton />
            <WorkingPanelToggle />
          </Flexbox>
        }
        slotClassNames={{
          center: headerStyles.slotCenter,
          left: headerStyles.slotLeft,
          right: headerStyles.slotRight,
        }}
      >
        <ViewSwitcher />
      </NavHeader>
    </div>
  );
});

export default Header;
