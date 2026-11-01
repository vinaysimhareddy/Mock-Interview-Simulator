import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isProd = mode === 'production' || process.env.NODE_ENV === 'production';
  const allowMockCamera = (env.VITE_ALLOW_MOCK_CAMERA || process.env.VITE_ALLOW_MOCK_CAMERA) === 'true';

  if (isProd && allowMockCamera) {
    throw new Error(
      '[SECURITY ERROR] VITE_ALLOW_MOCK_CAMERA=true is strictly forbidden in production builds. Production builds must only use physical camera devices.'
    );
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          ws: true,
        },
        '/health': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    },
  };
});

