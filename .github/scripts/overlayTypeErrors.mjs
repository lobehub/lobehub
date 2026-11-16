import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TYPE_ERROR = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/;

const errorKeys = (log) =>
  log
    .split('\n')
    .map((line) => line.trim().match(TYPE_ERROR))
    .filter(Boolean)
    .map(([, file, code, message]) => `${file}: ${code}: ${message}`);

export const newErrors = (baseLog, headLog) => {
  const unmatched = new Map();
  for (const key of errorKeys(baseLog)) unmatched.set(key, (unmatched.get(key) ?? 0) + 1);

  return errorKeys(headLog).filter((key) => {
    const left = unmatched.get(key) ?? 0;
    if (left === 0) return true;
    unmatched.set(key, left - 1);
    return false;
  });
};

const main = async ([basePath, headPath]) => {
  const baseLog = await readFile(basePath, 'utf8').catch(() => '');
  const headLog = await readFile(headPath, 'utf8');

  if (errorKeys(headLog).length === 0) {
    console.log('::error::The overlay type check failed without reporting a type error');
    return 1;
  }

  const introduced = newErrors(baseLog, headLog);
  if (introduced.length === 0) {
    console.log('::notice::Every overlay type error already exists on the base branch');
    return 0;
  }

  console.log(
    `::error::This pull request introduces ${introduced.length} type error(s) in the business overlay`,
  );
  for (const error of introduced) console.log(error);
  return 1;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
