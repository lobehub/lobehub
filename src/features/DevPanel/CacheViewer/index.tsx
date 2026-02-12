import { Center, Empty } from '@lobehub/ui';
import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CachePanelContextProvider } from './cacheProvider';
import DataTable from './DataTable';
import { getCacheFiles } from './getCacheEntries';

const CacheViewer = async () => {
  const { t } = useTranslation('components');
  const files = await getCacheFiles();

  if (!files || files.length === 0)
    return (
      <Center height={'80%'}>
        <Empty
          description={t('devTools.cache.empty')}
          descriptionProps={{ fontSize: 14 }}
          icon={Database}
          style={{ maxWidth: 400 }}
        />
      </Center>
    );

  return (
    <CachePanelContextProvider entries={files}>
      <DataTable />
    </CachePanelContextProvider>
  );
};

export default CacheViewer;
