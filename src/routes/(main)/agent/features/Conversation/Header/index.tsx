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
  left: css`
    min-width: 0;

    @container agent-conv-header (min-width: 720px) {
      max-width: calc(50% - 80px);
    }
  `,
  viewSwitcher: css`
    @container agent-conv-header (min-width: 720px) {
      pointer-events: none;

      position: absolute;
      inset-block-start: 50%;
      inset-inline-start: 50%;
      transform: translate(-50%, -50%);

      & > * {
        pointer-events: auto;
      }
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
            className={headerStyles.left}
            gap={4}
            style={{ backgroundColor: cssVar.colorBgContainer }}
          >
            <Tags />
            <HeaderActions />
          </Flexbox>
        }
        right={
          <Flexbox horizontal align={'center'} style={{ backgroundColor: cssVar.colorBgContainer }}>
            <Flexbox className={headerStyles.viewSwitcher}>
              <ViewSwitcher />
            </Flexbox>
            <ShareButton />
            <WorkingPanelToggle />
          </Flexbox>
        }
      />
    </div>
  );
});

export default Header;
