import { LocalSystemExecutionRuntime as BaseLocalSystemExecutionRuntime } from '@lobechat/builtin-tool-local-system/executionRuntime';

import { localFileService } from '@/services/electron/localFileService';

export class LocalSystemExecutionRuntime extends BaseLocalSystemExecutionRuntime {
  constructor() {
    super(localFileService);
  }
}
