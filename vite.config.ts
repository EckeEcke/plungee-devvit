import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { devvit } from '@devvit/start/vite'

export default defineConfig({ plugins: [vue(), devvit({ client: { build: { sourcemap: false } } })] })
