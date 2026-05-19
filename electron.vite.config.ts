import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': path.resolve('src/main'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@preload': path.resolve('src/preload'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': path.resolve('src/renderer'),
      },
    },
    plugins: [react()],

  },
})
