import type { ClientDataEntityRecord, ClientDataIndex, ClientDataSnapshot } from '@lobechat/types';

import { isClientDataEntityRecord } from './entities/validators';
import { isHomeIndex, isHomeSnapshot } from './modules/home/validators';
import { createClientDataRepository } from './persistence/repository';

export const clientDataRepository = createClientDataRepository<
  ClientDataEntityRecord,
  ClientDataIndex,
  ClientDataSnapshot
>({
  isEntity: isClientDataEntityRecord,
  isIndex: isHomeIndex,
  isSnapshot: isHomeSnapshot,
});
