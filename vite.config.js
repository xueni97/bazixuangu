import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 八字选股APP Vite 配置
// base 用相对路径，兼容 Capacitor Android 打包（file:// 协议加载）
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5175',
        changeOrigin: true,
      },
    },
  },
})
