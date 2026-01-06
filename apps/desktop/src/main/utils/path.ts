import { pathToFileURL } from 'node:url';

export const filePathToAppUrl = (filePath: string) => {
  return `app://lobehub.com${pathToFileURL(filePath).pathname}`;
};
