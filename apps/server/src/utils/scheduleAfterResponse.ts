import debug from 'debug';

const log = debug('lobe-server:schedule-after-response');

export type ScheduleAfterResponseWork = () => Promise<unknown> | unknown;

const runWork = async (work: ScheduleAfterResponseWork) => {
  try {
    await work();
  } catch (error) {
    log('Scheduled work threw: %O', error);
  }
};

export const after = (work: ScheduleAfterResponseWork): void => {
  try {
    const nextServer = require('next/server') as {
      after?: (work: () => Promise<void>) => void;
    };

    if (typeof nextServer.after === 'function') {
      try {
        nextServer.after(() => runWork(work));
        return;
      } catch (error) {
        log('next/server after() unavailable, falling back: %O', error);
      }
    }
  } catch {
    // next/server is not available in standalone Hono.
  }

  void runWork(work);
};
