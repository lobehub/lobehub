// Fixture: two methods each build their own path from a shared root; neither local
// is an authority the other could read, and they name different stores
// (desktop services/auvSrv.ts).
import path from 'node:path';

import { runAuvCli, startAuv } from './auvSdk';

export class AuvService {
  constructor(private readonly appStoragePath: string) {}

  async runCli(args: string[]) {
    return runAuvCli(args, {
      storeRoot: path.join(this.appStoragePath, 'auv', 'runs'),
    });
  }

  async open(binaryPath: string) {
    const auvRoot = path.join(this.appStoragePath, 'auv');
    return startAuv({ binaryPath, storeRoot: path.join(auvRoot, 'store') });
  }
}
