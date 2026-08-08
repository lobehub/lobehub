import { createDisplayWorkAdapter, registerExternalWork } from './displayWork';

export { registerExternalWork };

export const externalWorkAdapter = createDisplayWorkAdapter({ type: 'external' });
