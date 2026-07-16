import { defineConfig } from 'vite'

// 웹 데모는 web/ 에 있고, 엔진(src/)을 그대로 import 한다.
// 같은 로직이 데스크톱 CLI와 브라우저 데모에서 함께 돈다 — 중복 없음.
export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    fs: { allow: ['..'] }, // web/ 밖의 src/ 를 읽어야 한다
  },
})
