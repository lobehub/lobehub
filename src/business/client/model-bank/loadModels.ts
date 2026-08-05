import type { BuiltinModelIdentifier } from 'model-bank';

export const loadDefaultHiddenBuiltinModels = async (): Promise<BuiltinModelIdentifier[]> => [];

export { loadModels } from '@lobechat/business-model-bank/model-config';
