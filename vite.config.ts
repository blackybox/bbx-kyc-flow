import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'BbxKycFlow',
      formats: ['es', 'umd'],
      fileName: (format) => `bbx-kyc-flow.${format}.js`,
    },
  },
});
