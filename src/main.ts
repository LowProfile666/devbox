import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
// Element Plus 的暗色是一套独立的 CSS 变量，靠 html.dark 类名切换（不跟随媒体查询）
import 'element-plus/theme-chalk/dark/css-vars.css'
import { Plus, Delete, Clock, Key, CopyDocument } from '@element-plus/icons-vue'
import './main.css'
import App from './App.vue'
import { initTheme } from './host/theme'

// 主题：读用户设置（跟随系统/浅色/深色），给 html 打 dark 类，同时驱动我们和 Element Plus
initTheme()

const app = createApp(App)
app.use(ElementPlus)
app.component('Plus', Plus)
app.component('Delete', Delete)
app.component('Clock', Clock)
app.component('Key', Key)
app.component('CopyDocument', CopyDocument)
app.mount('#app')
