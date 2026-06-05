import { pathToFileURL } from 'node:url';

export const filePathToAppUrl = (filePath: string) => {
  return `app://nexumchat.com${pathToFileURL(filePath).pathname}`;
};
