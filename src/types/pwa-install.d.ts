import type { PWAInstallElement } from '@khmyznikov/pwa-install';
import type React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'pwa-install': React.DetailedHTMLProps<
        React.HTMLAttributes<PWAInstallElement>,
        PWAInstallElement
      >;
    }
  }
}

export {};
