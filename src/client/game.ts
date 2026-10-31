import { createApp } from 'vue'
import App from './PlungeeApp.vue'
import './style.css'
import { initAudio } from './plungee/audio/audio'

initAudio()
createApp(App).mount('#app')
