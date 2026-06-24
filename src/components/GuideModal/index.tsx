'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    h3 {
      margin: 0;
      font-weight: bold;
    }

    p {
      margin: 0;
    }
  `,
}));

interface GuideModalContentProps {
  cancelText?: ReactNode;
  cover: ReactNode;
  desc: ReactNode;
  okText?: ReactNode;
  onCancel?: () => void;
  onOk?: () => void;
  title: ReactNode;
}

const GuideModalContent = memo<GuideModalContentProps>(
  ({ cover, title, desc, okText, cancelText, onOk, onCancel }) => {
    const { close } = useModalContext();

    const handleOk = () => {
      onOk?.();
      close();
    };

    const handleCancel = () => {
      onCancel?.();
      close();
    };

    return (
      <Flexbox className={styles.body}>
        {cover}
        <Flexbox gap={4} padding={16}>
          <h3>{title}</h3>
          <p>{desc}</p>
        </Flexbox>
        {(okText || cancelText) && (
          <Flexbox
            horizontal
            gap={8}
            justify={'flex-end'}
            paddingBlock={16}
            paddingInline={16}
            style={{ paddingTop: 0 }}
          >
            {cancelText ? <Button onClick={handleCancel}>{cancelText}</Button> : null}
            {okText ? (
              <Button type={'primary'} onClick={handleOk}>
                {okText}
              </Button>
            ) : null}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

GuideModalContent.displayName = 'GuideModalContent';

export interface CreateGuideModalOptions {
  cancelText?: ReactNode;
  cover: ReactNode;
  desc: ReactNode;
  okText?: ReactNode;
  onCancel?: () => void;
  onOk?: () => void;
  title: ReactNode;
  width?: number;
}

export const createGuideModal = ({
  cancelText,
  cover,
  desc,
  okText,
  onCancel,
  onOk,
  title,
  width = 360,
}: CreateGuideModalOptions): ModalInstance =>
  createModal({
    content: (
      <GuideModalContent
        cancelText={cancelText}
        cover={cover}
        desc={desc}
        okText={okText}
        title={title}
        onCancel={onCancel}
        onOk={onOk}
      />
    ),
    footer: null,
    maskClosable: true,
    styles: {
      content: { padding: 0 },
      header: { display: 'none' },
    },
    width,
  });
