import { isArray, isObject, transform } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';

/**
 * Compare two objects and return the difference.
 * when there are difference in array, just return the new value.
 * it's used mostly in settings
 */
export const difference = <T extends object>(object: T, base: T) => {
  const changes = (object: any, base: any) =>
    transform(object, (result: any, value, key) => {
      // First, check if value and base[key] are both arrays.
      // If they are arrays, we directly use isEqual to compare their values.
      if (isArray(value) && isArray(base[key])) {
        if (!isEqual(value, base[key])) {
          result[key] = value;
        }
      }
      // If they are objects, we recursively call changes to compare their values.
      else if (!isEqual(value, base[key])) {
        result[key] = isObject(value) && isObject(base[key]) ? changes(value, base[key]) : value;
      }
    });

  return changes(object, base);
};
