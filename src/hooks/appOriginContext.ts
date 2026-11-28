import { createContext } from 'react';

// SSR hosts supply their public origin per request, including during hydration.
export const AppOriginContext = createContext<string | undefined>(undefined);
