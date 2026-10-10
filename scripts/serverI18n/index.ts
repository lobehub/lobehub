import { generateServerI18n } from './generate';

generateServerI18n(process.cwd()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
