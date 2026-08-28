'use client';

import {
  Button,
  createModal,
  type ImperativeModalProps as BaseImperativeModalProps,
  ModalFooter,
  type ModalInstance,
} from '@lobehub/ui/base-ui';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface LegacyModalButtonProps {
  [key: string]: unknown;
  block?: boolean;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: CSSProperties;
  type?: string;
}

interface LegacyModalClassNames {
  [key: string]: string | undefined;
  body?: string;
  content?: string;
  header?: string;
  wrapper?: string;
}

interface LegacyModalStyles {
  [key: string]: CSSProperties | undefined;
  body?: CSSProperties;
  content?: CSSProperties;
  header?: CSSProperties;
  wrapper?: CSSProperties;
}

export interface ImperativeModalProps extends Omit<
  BaseImperativeModalProps,
  'children' | 'classNames' | 'content' | 'footer' | 'open' | 'styles'
> {
  afterOpenChange?: (open: boolean) => void;
  allowFullscreen?: boolean;
  cancelButtonProps?: LegacyModalButtonProps;
  cancelText?: ReactNode;
  centered?: boolean;
  children?: ReactNode;
  className?: string;
  classNames?: LegacyModalClassNames;
  closable?: boolean;
  confirmLoading?: boolean;
  footer?: ReactNode;
  height?: number | string;
  keyboard?: boolean;
  loading?: boolean;
  okButtonProps?: LegacyModalButtonProps;
  okText?: ReactNode;
  onCancel?: (...args: any[]) => void;
  onOk?: (...args: any[]) => unknown | Promise<unknown>;
  open?: boolean;
  paddings?: { desktop?: number; mobile?: number };
  styles?: LegacyModalStyles;
}

const normalizeClassNames = (className?: string, classNames?: LegacyModalClassNames) => ({
  ...classNames,
  content: classNames?.content ?? classNames?.body,
  popup: [className, classNames?.wrapper].filter(Boolean).join(' ') || undefined,
});

const normalizeStyles = (styles?: LegacyModalStyles) => ({
  ...styles,
  content: styles?.content ?? styles?.body,
  popup: styles?.wrapper,
});

const ImperativeModal = ({
  afterOpenChange,
  cancelButtonProps,
  cancelText,
  children,
  className,
  classNames,
  confirmLoading,
  footer,
  loading,
  okButtonProps,
  okText,
  onCancel,
  onOk,
  open = false,
  styles,
  ...rest
}: ImperativeModalProps) => {
  const { t } = useTranslation('common');
  const modalRef = useRef<ModalInstance>(undefined);

  // `createModal` renders into its own host tree, so handing `children` over as
  // modal content would put them in a tree that only learns about caller state
  // one commit late (the update below runs in an effect). React then restores
  // the stale value onto controlled inputs at the end of each event, which
  // aborts IME composition — CJK input becomes impossible. Instead the modal
  // tree renders a stable empty slot and the children are portaled into it from
  // THIS tree, so their state and their inputs commit together (this also
  // matches how the antd modals behaved before the base-ui migration).
  const [contentHost, setContentHost] = useState<HTMLElement | null>(null);
  const contentSlot = useMemo(
    () => <div ref={setContentHost} style={{ display: 'contents' }} />,
    [],
  );
  const modalFooter = useMemo(() => {
    if (footer === null) return null;
    if (footer !== undefined) return footer;
    if (!onOk && !onCancel) return null;

    return (
      <ModalFooter>
        <Button disabled={cancelButtonProps?.disabled || confirmLoading} onClick={onCancel}>
          {cancelText ?? t('cancel')}
        </Button>
        <Button
          danger={okButtonProps?.danger}
          disabled={okButtonProps?.disabled}
          loading={confirmLoading || Boolean(okButtonProps?.loading)}
          type="primary"
          onClick={onOk}
        >
          {okText ?? t('ok', { defaultValue: 'OK' })}
        </Button>
      </ModalFooter>
    );
  }, [
    cancelButtonProps?.disabled,
    cancelText,
    confirmLoading,
    footer,
    okButtonProps?.danger,
    okButtonProps?.disabled,
    okButtonProps?.loading,
    okText,
    onCancel,
    onOk,
    t,
  ]);

  useEffect(() => {
    if (!open) {
      modalRef.current?.close();
      modalRef.current = undefined;
      afterOpenChange?.(false);
      return;
    }

    const modalProps = {
      ...rest,
      classNames: normalizeClassNames(className, classNames),
      content: contentSlot,
      footer: modalFooter,
      loading,
      onOpenChange: (nextOpen: boolean) => {
        afterOpenChange?.(nextOpen);
        rest.onOpenChange?.(nextOpen);
        if (!nextOpen) onCancel?.();
      },
      styles: normalizeStyles(styles),
    } as ImperativeModalProps;

    if (modalRef.current) {
      modalRef.current.update(modalProps);
      return;
    }

    modalRef.current = createModal(modalProps);
    afterOpenChange?.(true);
  }, [
    afterOpenChange,
    contentSlot,
    className,
    classNames,
    loading,
    modalFooter,
    onCancel,
    open,
    rest,
    styles,
  ]);

  useEffect(() => {
    return () => {
      modalRef.current?.close();
      modalRef.current = undefined;
    };
  }, []);

  // The slot unmounts only after the exit animation completes, so the children
  // stay mounted through it — unmounting on `open: false` would blank the panel
  // mid-animation and read as the body collapsing.
  if (!contentHost) return null;

  return createPortal(children, contentHost);
};

ImperativeModal.displayName = 'ImperativeModal';

export default ImperativeModal;
