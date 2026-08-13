import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' 让构建产物可用相对路径加载（HA ingress 下必须是相对路径）
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../rootfs/usr/local/bin/webui',
    emptyOutDir: false,
    assetsDir: 'assets',
  },
})
