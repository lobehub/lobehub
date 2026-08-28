import type { App } from '../core/App';

export class ServiceModule {
  constructor(public app: App) {
    this.app = app;
  }
}

export interface ServiceLifecycle {
  destroy?: () => void;
}

export type IServiceModule = new (app: App) => ServiceModule & ServiceLifecycle;
