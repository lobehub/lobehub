import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles, responsive } from 'antd-style';
import { XIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { useState } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  close: css`
    position: absolute;
    inset-block-start: 16px;
    inset-inline-end: 16px;
  `,
  container: css`
    position: relative;

    width: 100%;
    padding-inline: 40px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};

    ${responsive.sm} {
      width: 100%;
      padding-inline: 12px;
    }
  `,
}));

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
      <Flexbox className={styles.container}>
        <ActionIcon
          className={styles.close}
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
