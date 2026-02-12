import { type ReactNode } from 'react';
import { memo } from 'react';

import { createStore, Provider } from './store';
import { type StoreUpdaterProps } from './StoreUpdater';
import StoreUpdater from './StoreUpdater';

interface AgentSettingsProps extends StoreUpdaterProps {
  children: ReactNode;
}

export const AgentSettingsProvider = memo<AgentSettingsProps>(({ children, ...props }) => {
  return (
    <Provider createStore={createStore}>
      <StoreUpdater {...props} />
      {children}
    </Provider>
  );
});
