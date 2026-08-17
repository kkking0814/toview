# TOVIEW — 기준점 통합 복원본

## 고정 디자인 기준
- 홈: 확정 홈 기준 이미지. 전체 사이트의 화이트/연회색 + 네이비 + 블루 + 절제된 골드 색상 기준.
- 미니게임(results.html): 확정 미니게임 이미지. 11게임, 자체 애니메이션, 결과대기/확인, 오른쪽 대형 실시간 채팅, PICK, 통계, 패턴, 내 PICK.
- 분석: 확정 분석 이미지의 좌측 메뉴/지표/분포/차트/우측 요약 구조.
- 패턴: 확정 패턴 기준 구조. 게임/날짜/패턴종류/정렬/전체회차.
- 스포츠: 확정 스포츠 이미지. 중앙 경기/플레이어, 경기목록, 우측 채팅/경기정보, 스포츠 PICK.
- 커뮤니티: 확정 커뮤니티 이미지. 좌측 메뉴, 중앙 게시판, 우측 채팅/인기글. 글쓰기만 존재하며 끌어올리기 없음.
- 랭킹: 확정 랭킹 이미지. 포인트 시스템 없음. 전체/스포츠/미니/적중률/연승/레벨 랭킹.
- 보증업체: 확정 토토핫 참고 TOVIEW 이미지. 3열 광고형 카드, 상세보기, 바로가기, 검색/필터.

## 버튼/기능 계약
### 공통
- TOVIEW 로고 → index.html.
- 상단 미니게임/분석/패턴/스포츠/커뮤니티/랭킹/보증업체 → 해당 HTML.
- 로그인 → account.html. 로그인 후 사용자 버튼 → 계정/대시보드 흐름.
- 게임 기본 5개 → 즉시 선택, URL game 파라미터와 최근게임 저장.
- 더보기 → 같은 위치 아래 6개 펼침. 추가게임 클릭 → 게임 선택 + 자동 닫힘 + /api/activity.

### 미니게임
- 게임 버튼 → /api/games/:id/snapshot + /results 로드, Renderer 교체.
- PICK 홀/짝 → 클라이언트 선택만 수행.
- PICK 등록 → 현재 roundId + marketType + selection + visibility를 POST /api/picks/mini.
- 서버가 마감/중복을 거부하며 PICK update/delete API는 제공하지 않음.
- SSE game-result → 확정 DB 결과를 animation.js Renderer에 즉시 전달.
- 채팅 전송 → POST /api/chat/MINI. SSE/재조회로 채팅 반영.
- 패턴 상세 → pattern.html.

### 스포츠
- 경기 보기 → 선택 경기의 스코어/리그/상태/경기정보/PICK 대상을 동시에 변경.
- 홈/무/원정 → PICK 선택.
- PICK 확정 → POST /api/picks/sports. 서버 transaction에서 경기 시작시각/상태 재확인.
- 실시간 채팅 → /api/chat/SPORTS.
- 영상은 stream_provider/stream_ref에 허가된 공급처가 있을 때만 연결하는 정책.

### 커뮤니티
- 전체/자유/PICK 공유 → 게시판 필터.
- 검색 → 현재 불러온 게시글 제목+본문 필터.
- 글쓰기 → 작성 패널 열기. 끌어올리기 기능 없음.
- 닫기 → 작성 패널 닫기.
- 등록하기 → POST /api/community/posts.
- 실시간 대화 → /api/chat/COMMUNITY.
- 게시글 제목 → post id가 포함된 상세 URL로 이동.

### 분석
- 게임 선택 → /api/games/:id/analysis + /results 재조회.
- 오늘/3일/7일/30일/90일 → 분석 기간 변경 후 재조회.
- 지표/분포/최근회차는 확정 결과만 사용.

### 패턴
- 게임 선택 → 선택 게임 변경.
- 날짜/패턴종류/정렬 → 조건 설정.
- 적용 → /api/games/:id/pattern 재조회.

### 랭킹
- 전체/스포츠/미니/적중률/연승 → /api/rankings 기반 표시.
- 레벨 랭킹 → /api/rankings/levels.
- 레벨/XP는 비금전성 활동 시스템. 지갑/잔액/환전/지급 시스템 없음.

### 보증업체
- 카테고리 → 카드 필터.
- 검색 → 업체명 검색.
- 상세보기 → 해당 업체의 보증상태/최근검토/평가 표시.
- 바로가기 → 등록된 외부 URL을 새 탭으로 열기.
- 등록되지 않은 URL은 바로가기 비활성.

### 관리자
- admin/super_admin만 관리자 middleware 통과.
- super_admin은 최고 운영권한 계층.
- 일반 사용자가 클라이언트에서 role을 변경할 수 없음.

## 데이터/보안
- 이메일 인증: Resend 경로 /api/email/send → /api/email/verify → 가입.
- SESSION_SECRET 운영환경 필수.
- 비활동 세션 10분.
- CSRF same-origin 방어 및 로그인/가입/이메일 rate limit.
- 미니/스포츠 PICK DB UNIQUE 중복방지.
- PICK 공개범위 PUBLIC/FOLLOWERS/MUTUALS/PRIVATE.
- SSE 연결 제한 및 collector 중복 polling 방지.
- 포인트/지갑/잔액/payout 시스템 없음.

## 자체검사
`npm test`
- JS/Node 문법
- HTML ID 중복
- CSS/JS asset 경로
- 11게임 = 기본5 + 더보기6
- 더보기 인라인/선택후 자동닫힘
- 홈 구조
- Resend/10분 세션/protected pages
- super_admin
- 확정 페이지별 핵심 UI
- 채팅 API + DB
- 레벨/XP
- 핵심 버튼 ID ↔ JS handler
- wallet/balance/payout 부재

실제 Resend 발신권한, Render 환경변수, Neon migration, 외부 game/sports provider는 운영환경에서 별도 확인해야 합니다.
