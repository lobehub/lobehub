import debug from 'debug';
import { after as nextAfter } from 'next/server';

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
    nextAfter(() => runWork(work));
    return;
  } catch (error) {
    log('after() unavailable outside a request scope, running inline: %O', error);
  }

  void runWork(work);
};
