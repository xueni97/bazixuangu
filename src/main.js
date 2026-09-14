import { createApp } from 'vue'
import Vant from 'vant'
import 'vant/lib/index.css'
import App from './App.vue'
import router from './router'
import './styles/main.css'
import { autoSyncOnStartup } from './lib/market/maSync.js'

const app = createApp(App)
app.use(Vant)
app.use(router)
app.mount('#app')

// APP 启动自动后台同步：当日快照未拉则拉快照，快照就绪后均线未对齐则增量同步。
// 不 await，后台执行不阻塞 UI；IndexedDB 首次打开可能耗时，故在 mount 后触发。
autoSyncOnStartup()
