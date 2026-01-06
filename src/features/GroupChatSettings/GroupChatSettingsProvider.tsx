import { type ReactNode, memo } from 'react';

import StoreUpdater, { type StoreUpdaterProps } from './StoreUpdater';
import { Provider, createStore } from './store';

interface GroupChatSettingsProviderProps extends StoreUpdaterProps {
  children: ReactNode;
}

export const GroupChatSettingsProvider = memo<GroupChatSettingsProviderProps>(
  ({ children, ...props }) => {
    return (
      <Provider createStore={createStore}>
        <StoreUpdater {...props} />
        {children}
      </Provider>
    );
  },
);
