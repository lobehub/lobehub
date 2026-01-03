import { defineConfig } from './src/libs/next/config/define-config';

const nextConfig = defineConfig({
  experimental: {
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
  },
  webpack: (webpackConfig, context) => {
    const { dev } = context;
    if (!dev) {
      webpackConfig.cache = false;
    }

    return webpackConfig;
  },
});

export default nextConfig;
