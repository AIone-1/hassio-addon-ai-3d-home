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
    // 代码分割：把 three / react 拆成独立 chunk，app 更新时不用重新下载大块依赖
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/@react-three') || id.includes('node_modules/react')) return 'react-r3f'
        },
      },
    },
  },
})
