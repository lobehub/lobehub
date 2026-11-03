import { setupBootProfiler } from './bootProfiler';
import { setupElectronApi } from './electronApi';
import { reportLoadingScreenPainted } from './loadingScreenPainted';
import { setupRouteInterceptors } from './routeInterceptor';

const setupPreload = () => {
  setupBootProfiler();
  reportLoadingScreenPainted();
  setupElectronApi();

  // Setup route interception logic
  window.addEventListener('DOMContentLoaded', () => {
    // Setup client-side route interceptor
    setupRouteInterceptors();
  });
};

setupPreload();
