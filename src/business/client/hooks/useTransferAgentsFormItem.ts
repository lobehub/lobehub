import type { FormGroupItemType } from '@lobehub/ui';
import { Text } from '@lobehub/ui';
import { createElement } from 'react';

export const useTransferAgentsFormItem = (): FormGroupItemType['children'] =>
  createElement(
    Text,
    { type: 'secondary' },
    'Агенты можно переносить между workspace через меню агента.',
  );
