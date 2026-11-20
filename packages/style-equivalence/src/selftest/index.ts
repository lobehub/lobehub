import { launchBrowser } from '../capture/browser';
import { runCssCorpus, type SelfTestReport } from './run';
import { runSourceCorpus } from './sourceCorpus/run';

export const runSelfTest = async (options: {
  configFile: string;
  recordsDir: string;
  repo: string;
}): Promise<SelfTestReport> => {
  const browser = await launchBrowser();
  try {
    const css = await runCssCorpus({ browser });
    const source = await runSourceCorpus({ ...options, browser });
    return { css, passed: [...css, ...source].every((entry) => entry.passed), source };
  } finally {
    await browser.close();
  }
};
