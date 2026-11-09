import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Tauri CLI 用管道读取 Vite 输出，清屏会把关键信息冲掉
  clearScreen: false,
  server: {
    // 与 src-tauri/tauri.conf.json 的 build.devUrl 保持一致，端口被占用时直接报错而不是静默换端口
    port: 5173,
    strictPort: true,
    // 监听 Rust 侧改动没有意义，反而会触发无谓的热更新
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    // WebView2 内核，不必为老浏览器降级
    target: 'chrome110',
  },
})
