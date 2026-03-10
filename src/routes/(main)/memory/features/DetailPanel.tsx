import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { type NavHeaderProps } from '@/features/NavHeader';
import NavHeader from '@/features/NavHeader';
import RightPanel from '@/features/RightPanel';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';

interface DetailPanelProps extends FlexboxProps {
  header?: NavHeaderProps;
}

const DetailPanel = memo<DetailPanelProps>(({ children, style, header, ...rest }) => {
  return (
    <RightPanel defaultWidth={480} maxWidth={640} minWidth={300}>
      <NavHeader
        {...header}
        left={
          <>
            <ToggleRightPanelButton />
            {header?.left}
          </>
        }
      />
      <Flexbox
        flex={1}
        gap={16}
        height={'100%'}
        paddingInline={16}
        style={{
          minWidth: 300,
          overflowY: 'auto',
          paddingBottom: 64,
          paddingTop: 16,
          ...style,
        }}
        {...rest}
      >
        {children}
      </Flexbox>
    </RightPanel>
  );
});

export default DetailPanel;
