'use client';

import { memo, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';

import WorkbenchLoading from './WorkbenchLoading';

interface WorkbenchNamespaceProps extends PropsWithChildren {
  namespace: 'verify';
}

const WorkbenchNamespace = memo<WorkbenchNamespaceProps>(({ children, namespace }) => {
  const { ready } = useTranslation(namespace);

  if (!ready) {
    return (
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          height: '100dvh',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        <WorkbenchLoading />
      </div>
    );
  }

  return children;
});

WorkbenchNamespace.displayName = 'WorkbenchNamespace';

export default WorkbenchNamespace;
