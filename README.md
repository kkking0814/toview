# TOVIEW V8
실제 Node.js 서버가 포함된 버전입니다.

## 실행
1. Node.js 18+ 설치
2. 이 폴더에서 `npm install`
3. `npm start`
4. 브라우저에서 http://localhost:3000

## 포함
- 여러 HTML 페이지 이동
- 서버 기반 회원가입/로그인 세션 API
- 서버 기반 게시글 저장 API
- 외부 결과 API 프록시 엔드포인트 `/api/results`

## 공개 배포
Render/Railway/Fly.io 등 Node.js 호스팅에 이 폴더를 올리고 Start Command를 `npm start`로 설정하세요.
운영 환경에서는 SESSION_SECRET 환경변수를 반드시 설정하고, 영구 서비스에는 SQLite/PostgreSQL 등 DB로 data.json을 교체하세요.
