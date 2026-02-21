'use client';

import { Flexbox } from '@lobehub/ui';
import { type ModalProps } from 'antd';
import { ConfigProvider, Modal } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => {
  return {
    content: css`
      .${prefixCls}-modal-footer {
        margin: 0;
        padding: 16px;
      }
      .${prefixCls}-modal-header {
        display: flex;
        gap: 4px;
        align-items: center;
        justify-content: center;

        height: 56px;
        margin-block-end: 0;
        padding: 16px;
      }
      .${prefixCls}-modal-container {
        overflow: hidden;
        padding: 0;
        border: 1px solid ${cssVar.colorSplit};
        border-radius: ${cssVar.borderRadiusLG};
      }
    `,
    wrap: css`
      overflow: hidden auto;
    `,
  };
});

interface GuideModalProps extends ModalProps {
  cover: ReactNode;
  desc: ReactNode;
  title: ReactNode;
}

const GuideModal = memo<GuideModalProps>(
  ({ className, title, desc, cover, width = 360, ...rest }) => {
    const configTheme = useMemo(
      () => ({
        token: {
          colorBgElevated: `color-mix(in srgb, ${cssVar.colorBgContainer} 99.5%, white)`,
        },
      }),
      [],
    );

    return (
      <ConfigProvider theme={configTheme}>
        <Modal
          centered
          maskClosable
          className={cx(styles.content, className)}
          closable={false}
          width={width}
          wrapClassName={styles.wrap}
          {...rest}
        >
          {cover}
          <Flexbox padding={16}>
            <h3 style={{ fontWeight: 'bold' }}>{title}</h3>
            <p style={{ marginBottom: 0 }}>{desc}</p>
          </Flexbox>
        </Modal>
      </ConfigProvider>
    );
  },
);

export default GuideModal;
