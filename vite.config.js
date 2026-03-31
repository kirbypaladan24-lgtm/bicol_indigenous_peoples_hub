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
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        posts: resolve(__dirname, 'posts.html'),
        signup: resolve(__dirname, 'signup.html'),
        profile: resolve(__dirname, 'profile.html'),
        admin: resolve(__dirname, 'admin.html'),
        charts: resolve(__dirname, 'charts.html'),
        metricHistory: resolve(__dirname, 'metric-history.html'),
        superadmin: resolve(__dirname, 'superadmin.html'),
        tracker: resolve(__dirname, 'tracker.html'),
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
