import { type ReactNode, memo } from 'react';

import StoreUpdater, { type StoreUpdaterProps } from './StoreUpdater';
import { Provider, createStore } from './store';

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
