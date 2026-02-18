/**
 * Stores classes in the application that require decorators
 */
export class IoCContainer {
  static shortcuts: WeakMap<any, { methodName: string; name: string }[]> = new WeakMap();

  static protocolHandlers: WeakMap<any, { action: string; methodName: string; urlType: string }[]> =
    new WeakMap();

  init() {}
}
