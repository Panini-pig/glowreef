import { defineConfig } from 'vite';

// 部署到 Cloudflare Pages 时用相对路径，避免子路径部署（user.pages.dev/xxx）404
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    // 轮询监听：在某些中文路径 / 云端同步盘下，原生 watcher 会因临时文件锁报 EBUSY
    watch: { usePolling: true, interval: 350 },
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
  },
});
