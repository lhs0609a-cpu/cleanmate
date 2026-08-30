import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// 웹은 web/ 에 있고, 엔진(src/)을 그대로 import 한다.
// 페이지 셋: index.html(마케팅 랜딩) + app.html(체험 데모) + admin.html(관리자).
// 관리자 화면은 서버 함수(api/)와 비밀번호로 막혀 있고, 여기선 정적 파일일 뿐이다.
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
        admin: resolve('web/admin.html'),
      },
    },
  },
  server: {
    fs: { allow: ['..'] }, // web/ 밖의 src/ 를 읽어야 한다
  },
})
