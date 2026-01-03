import { isNil, omitBy } from 'es-toolkit/compat';

/**
 * Clean empty values (undefined, null, empty string) from an object
 * @param obj The object to clean
 * @returns The cleaned object
 */
export const cleanObject = <T extends Record<string, any>>(obj: T): T => {
  return omitBy(obj, (value) => isNil(value) || value === '') as T;
};
