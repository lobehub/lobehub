import { EmptyState } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';

const NotFound = () => (
  <Flexbox align={'center'} justify={'center'} style={{ minHeight: '60vh' }}>
    <EmptyState title={'Group Agent not found'} />
  </Flexbox>
);

export default NotFound;
