import { createApp, createSSRApp } from 'vue'
import App from './app.vue'
import './assets/scss/main.scss'

const root = document.getElementById('app')
const app = root.childElementCount ? createSSRApp(App) : createApp(App)
app.mount(root)
