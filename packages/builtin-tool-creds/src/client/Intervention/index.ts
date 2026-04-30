import type { BuiltinIntervention } from '@lobechat/types';

import { CredsApiName } from '../../types';
import SecureCredentialForm from './SecureCredentialForm';

export const CredsInterventions: Record<string, BuiltinIntervention> = {
  [CredsApiName.saveCreds]: SecureCredentialForm as BuiltinIntervention,
};
