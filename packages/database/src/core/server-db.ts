import type { LobeChatDatabase } from '../type';
import { getDBInstance } from './web-server';

let cachedDB: LobeChatDatabase | undefined;

const resolveDB = () => (cachedDB ??= getDBInstance());

/**
 * Synchronous legacy database handle with lazy initialization.
 * Property access, not module import, is the point where environment validation occurs.
 */
export const serverDB = new Proxy({} as LobeChatDatabase, {
  get: (_, property) => {
    const db = resolveDB();
    const value = Reflect.get(db, property);
    return typeof value === 'function' ? value.bind(db) : value;
  },
  set: (_, property, value) => Reflect.set(resolveDB(), property, value),
});
