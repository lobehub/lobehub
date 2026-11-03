import { parse } from 'partial-json';
import { useMemo } from 'react';
import { stringify } from 'yaml';

export const useYamlArguments = (args?: string) => {
  return useMemo(() => {
    if (!args) return '';

    try {
      const obj = parse(args);

      if (Object.keys(obj).length === 0) return '';

      return stringify(obj);
    } catch {
      return args;
    }
  }, [args]);
};
