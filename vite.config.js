import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// 八字选股APP Vite 配置
// base 用相对路径，兼容 Capacitor Android 打包（file:// 协议加载）
// loadEnv 把根目录 .env 注入 import.meta.env（VITE_ 前缀才暴露给前端）
//   VITE_API_BASE=http://server_ip:5000 → 浏览器访问服务器 Web 版回测直连此 base
//   留空 = APP / 本地开发模式（IndexedDB + 网络兜底链）
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // 后端 Flask 端口（本地开发 .env FLASK_PORT=5175）
  const apiPort = env.FLASK_PORT || '5175'
  const apiTarget = env.VITE_API_BASE || `http://127.0.0.1:${apiPort}`

  return {
    base: './',
    plugins: [vue()],
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
