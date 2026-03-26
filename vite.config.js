// vite.config.js - Build configuration for Bicol IP Hub
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',

  // Environment variables prefix
  envPrefix: 'VITE_',
  
  // Build settings
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        signup: resolve(__dirname, 'signup.html'),
        profile: resolve(__dirname, 'profile.html'),
        admin: resolve(__dirname, 'admin.html'),
        landmark: resolve(__dirname, 'landmark.html'),
        policy: resolve(__dirname, 'policy.html')
      }
    }
  },
  
  // Development server
  server: {
    port: 3000,
    open: true
  },
  
  // CSS settings
  css: {
    devSourcemap: true
  }
});
