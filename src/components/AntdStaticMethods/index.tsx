// Entry component
import { App } from 'antd';
import { type ModalStaticFunctions } from 'antd/es/modal/confirm';
import { memo } from 'react';

// eslint-disable-next-line import-x/no-mutable-exports
let notification: ReturnType<typeof App.useApp>['notification'];
// eslint-disable-next-line import-x/no-mutable-exports
let modal: Omit<ModalStaticFunctions, 'warn'>;

export default memo(() => {
  const staticFunction = App.useApp();
  modal = staticFunction.modal;
  notification = staticFunction.notification;
  return null;
});

export { modal, notification };
