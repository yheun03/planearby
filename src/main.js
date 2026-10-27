import { createApp, createSSRApp } from 'vue'
import App from './App.vue'
import './styles/main.scss'

const root = document.getElementById('app')
const app = root.childElementCount ? createSSRApp(App) : createApp(App)
app.mount(root)
