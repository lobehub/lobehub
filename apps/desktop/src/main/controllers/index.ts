import type { App } from '@/core/App';
import { IoCContainer } from '@/core/infrastructure/IoCContainer';
import { ShortcutActionType } from '@/shortcuts';
import { IpcService } from '@/utils/ipc';

const shortcutDecorator = (name: string) => (target: any, methodName: string, descriptor?: any) => {
  const actions = IoCContainer.shortcuts.get(target.constructor) || [];
  actions.push({ methodName, name });

  IoCContainer.shortcuts.set(target.constructor, actions);

  return descriptor;
};

/**
 *  shortcut inject decorator
 */
export const shortcut = (method: ShortcutActionType) => shortcutDecorator(method);

const protocolDecorator =
  (urlType: string, action: string) => (target: any, methodName: string, descriptor?: any) => {
    const handlers = IoCContainer.protocolHandlers.get(target.constructor) || [];
    handlers.push({ action, methodName, urlType });

    IoCContainer.protocolHandlers.set(target.constructor, handlers);

    return descriptor;
  };

/**
 * Protocol handler decorator
 * @param urlType Protocol URL type (e.g., 'plugin')
 * @param action Action type (e.g., 'install')
 */
export const createProtocolHandler = (urlType: string) => (action: string) =>
  protocolDecorator(urlType, action);

interface IControllerModule {
  afterAppReady?(): void;
  app: App;
  beforeAppReady?(): void;
}

export class ControllerModule extends IpcService implements IControllerModule {
  constructor(public app: App) {
    super();
    this.app = app;
  }
}

export type IControlModule = typeof ControllerModule;

export { IpcMethod } from '@/utils/ipc';
