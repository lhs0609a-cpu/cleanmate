import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// 웹은 web/ 에 있고, 엔진(src/)을 그대로 import 한다.
// 페이지 둘: index.html(마케팅 랜딩) + app.html(체험 데모).
export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve('web/index.html'),
        app: resolve('web/app.html'),
      },
    },
  },
  server: {
    fs: { allow: ['..'] }, // web/ 밖의 src/ 를 읽어야 한다
  },
})
