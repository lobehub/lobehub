import { App } from 'antd';
import { type ModalFuncProps } from 'antd/es/modal/interface';
import { type MutableRefObject, type ReactNode, type RefObject, useRef } from 'react';

import { closeIcon, styles } from './style';

interface CreateModalProps extends ModalFuncProps {
  content: ReactNode;
}

interface ModalInstance {
  destroy: (...args: any[]) => void;
}

type PropsFunc<T = undefined> = (
  instance: MutableRefObject<ModalInstance | undefined>,
  props?: T,
) => CreateModalProps;

const createModal = <T>(params: CreateModalProps | PropsFunc<T>) => {
  const useModal = () => {
    const { modal } = App.useApp();
    const instanceRef = useRef<ModalInstance>(null);

    const open = (outProps?: T) => {
      const props =
        typeof params === 'function'
          ? params(instanceRef as RefObject<ModalInstance>, outProps)
          : params;

      instanceRef.current = modal.confirm({
        className: styles.content,
        closable: true,
        closeIcon,
        footer: false,
        icon: null,
        wrapClassName: styles.wrap,
        ...props,
      });
    };

    return { open };
  };

  return useModal;
};

export { createModal };
