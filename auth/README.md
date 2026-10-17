# 공통 로그인 설정 서버

프로덕션 API: `https://beauty-blossom-prompt-auth.beautyblossom.workers.dev`

이 Worker는 로그인과 관리자 설정만 처리한다. GitHub의 공개 이미지와 프롬프트 파일을 프록시하거나 접근 차단하지 않는다. 계정 비밀번호·초기 해시·세션 토큰은 이 저장소에 넣지 않는다.

## 개발과 배포

1. 이 폴더에서 `npm ci`.
2. `npx wrangler d1 execute DB --local --file schema.sql`로 로컬 테이블 생성.
3. 로컬 전용 계정을 별도로 준비. 비밀번호 해시는 UTF-8, PBKDF2-SHA256 100,000회, 임의 32바이트 salt, 32바이트 결과를 사용하며 salt/hash 모두 hex 형식이다. 초기 INSERT는 `INSERT OR IGNORE`를 사용해 기존 비밀번호를 덮어쓰지 않는다. 입력/SQL 파일은 무시되는 `../output/` 안에 두고, 실제 비밀번호를 터미널에 출력하지 않는다.
4. `npx wrangler dev --ip 127.0.0.1 --port 8787 --var ALLOWED_ORIGIN:http://127.0.0.1:8765`.
5. 개발 브라우저 테스트에서 API 요청을 로컬 Worker로 라우팅한다. 정식 `entry.js`의 API URL은 프로덕션 주소를 유지한다.
6. `npm run check`와 `npx wrangler deploy --dry-run` 검증 후 `npx wrangler deploy`. 기존 운영 DB에는 초기 SQL을 다시 쓰거나 비밀번호를 리셋하지 않는다.

## 동작

- `POST /login`: 아이디/비밀번호 검증, 12시간 세션 생성. 원문 비밀번호는 저장하지 않는다.
- `GET /session`: 서버 세션과 계정 버전 확인.
- `POST /logout`: 현재 세션 폐기.
- `GET /admin/password`: 관리자에게 팀원 아이디/설정 버전/변경 시각만 제공.
- `POST /admin/password`: 관리자 세션과 비밀번호 재확인 후 팀원 비밀번호 변경. 클라이언트 버전을 조건으로 갱신해 두 탭의 덮어쓰기를 방지한다. 계정 버전 증가로 기존 팀원 세션을 무효화한다.

D1 직접 쿼리는 primary에서 실행한다. 모든 SQL은 바인딩을 사용한다. 요청 JSON 최대 4KB, 비밀번호 4~128자, 로그인의 한글 아이디는 NFC 정규화한다. 비밀번호의 공백/유니코드는 그대로 보존한다. 로그인은 IP별 분당 15회, 관리자 변경 시도는 분당 8회 제한한다. 로그에는 비밀번호/요청 본문/토큰을 기록하지 않는다.

관리자 계정 복구가 필요하면 Cloudflare 계정 소유자가 해당 `accounts` 행에 새 salt/hash를 적용하고 `version = version + 1`로 기존 관리자 세션도 폐기해야 한다. 브라우저에서 관리자 비밀번호나 GitHub 토큰을 공개 설정으로 내려주지 않는다.
