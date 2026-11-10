import { Flexbox, Text } from '@lobehub/ui';
import type { ReactNode } from 'react';

/** Section label — one consistent treatment for every field heading in the detail panel. */
const FieldLabel = ({ children, extra }: { children: ReactNode; extra?: ReactNode }) => (
  <Flexbox horizontal align={'center'} distribution={'space-between'}>
    <Text fontSize={12} type={'secondary'} weight={500}>
      {children}
    </Text>
    {extra}
  </Flexbox>
);

export default FieldLabel;
