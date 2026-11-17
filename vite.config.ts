import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths, so the built site works from any sub-path (e.g. GitHub Pages /<repo>/).
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
} as any);
