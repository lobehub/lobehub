import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { XIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { useState } from 'react';

const styles = stylex.create({
  close: { position: 'absolute', insetBlockStart: '16px', insetInlineEnd: '16px' },
  container: {
    position: 'relative',
    width: '100%',
    paddingInline: { default: '40px', [media.sm]: '12px' },
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

const Container = ({
  setError,
  children,
}: {
  children: ReactNode;
  setError: (error?: any) => void;
}) => {
  const [show, setShow] = useState(true);

  return (
    show && (
      <Flexbox className={stylex.props(styles.container).className}>
        <ActionIcon
          className={stylex.props(styles.close).className}
          icon={XIcon}
          onClick={() => {
            setShow(false);
            setError(undefined);
          }}
        />
        {children}
      </Flexbox>
    )
  );
};

export default Container;
