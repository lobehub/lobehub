import type { LobeChatDatabase } from '../type';
import { getDBInstance } from './web-server';

let cachedDB: LobeChatDatabase | undefined;

const resolveDB = () => (cachedDB ??= getDBInstance());

/**
 * Synchronous legacy database handle with lazy initialization.
 * Property access, not module import, is the point where environment validation occurs.
 * Forward the full object protocol so consumers cannot observe the proxy boundary.
 */
export const serverDB = new Proxy({} as LobeChatDatabase, {
  defineProperty: (_, property, attributes) =>
    Reflect.defineProperty(resolveDB(), property, attributes),
  deleteProperty: (_, property) => Reflect.deleteProperty(resolveDB(), property),
  get: (_, property) => {
    const db = resolveDB();
    const value = Reflect.get(db, property);
    return typeof value === 'function' ? value.bind(db) : value;
  },
  getOwnPropertyDescriptor: (_, property) =>
    Reflect.getOwnPropertyDescriptor(resolveDB(), property),
  getPrototypeOf: () => Reflect.getPrototypeOf(resolveDB()),
  has: (_, property) => Reflect.has(resolveDB(), property),
  ownKeys: () => Reflect.ownKeys(resolveDB()),
  set: (_, property, value) => Reflect.set(resolveDB(), property, value),
  setPrototypeOf: (_, prototype) => Reflect.setPrototypeOf(resolveDB(), prototype),
});
