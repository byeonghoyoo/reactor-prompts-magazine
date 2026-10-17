# 프롬프트 노트

[프롬프트 노트 열기](https://byeonghoyoo.github.io/reactor-prompts-magazine/)

Reactor 갤러리와 PC의 PromptStudio 자료를 하나로 정리한 개인 프롬프트 라이브러리입니다.

## 사용하기

공유받은 아이디와 비밀번호를 입력하면 라이브러리가 열립니다. 같은 탭에서는 새로고침 후에도 입장 상태를 유지하며, 로그아웃하면 로그인 화면으로 돌아갑니다.

- 6개 주제 묶음, 27개 카테고리에서 이미지와 프롬프트를 찾습니다.
- 제목·설명·태그를 검색하고, 프롬프트/변수가 있는 카드만 필터링합니다.
- 카드를 열어 변수를 바꾸고 프롬프트를 편집·복사합니다. ChatGPT, Gemini, Higgsfield 열기 버튼은 복사와 서비스 페이지 열기를 제공합니다.
- 마음에 드는 카드는 즐겨찾기에 담습니다. 라이브러리 프롬프트는 화면에서 수정·복사하며, 별도의 노트 저장 기능은 없습니다.
- **내 카드**에서는 가져온 사용자 카드를 모아 볼 수 있습니다. 프롬프트 저장·카드 추가 기능은 제거했으며, 수정은 현재 열린 화면에서만 적용됩니다.

**즐겨찾기는 현재 브라우저의 IndexedDB에 저장됩니다. 수정한 라이브러리 프롬프트는 저장되지 않습니다. GitHub나 다른 기기에 자동 동기화되지 않습니다.** 기존 버전에서 저장한 편집·메모·태그는 삭제하지 않습니다. 백업·자료 안내 화면과 가져오기/내보내기 기능은 제거했습니다. 라이브러리 카드는 이전 편집값 대신 원본 자료를 표시합니다. 이미지 분석·생성 API는 연결하지 않았습니다.

## 보관 범위

| 항목 | 수량 |
|---|---:|
| 통합 카드 | 27,162 |
| 프롬프트가 있는 카드 | 25,835 |
| 기존 Reactor 게시물 | 4,361 |
| PromptStudio 원본 카드 | 23,616 |
| 중복 병합 | 815 |
| 새로 추가한 PromptStudio 카드 | 22,801 |
| PC에 저장된 이미지 파일 | 24,024 |
| PC 이미지의 고유 SHA-256 | 22,812 |

중복은 공백·유니코드를 정규화한 프롬프트와 변수 기본값을 적용한 결과를 비교했습니다. 같은 프롬프트의 추가 이미지를 합치고, 수정할 수 있는 변수가 더 많은 템플릿을 보존했습니다. 카테고리는 제목·설명·태그·프롬프트의 용도에 따라 분류했습니다.

- [PromptStudio 이미지 ZIP 5개와 전체 데이터](https://github.com/byeonghoyoo/reactor-prompts-magazine/releases/tag/promptstudio-2026-10-17): PC 이미지 4,008,062,102바이트. **대부분 앱이 캐시한 미리보기**이며, PC에 있던 파일을 재압축하지 않고 ZIP에 보관했습니다. 파일이 없는 이전 사용자 카드 이미지 2개는 [누락 기록](library/missing-images.json)에 남겼습니다.
- [기존 Reactor 원본 ZIP 8개](https://github.com/byeonghoyoo/reactor-prompts-magazine/releases/tag/snapshot-2026-10-17): 원본 이미지 16,011장과 추가 썸네일 3,714개를 보관했습니다. 원래 서버에서 404였던 이미지 2,516장은 [기존 누락 기록](missing-images.json)에 남아 있습니다.
- [통합 결과](library/import-report.json) · [중복 병합 기록](library/duplicates.json) · [검증 보고서](QA_REPORT.md)

기존 원본 데이터 `source/gallery-data.json`, 번역 `source/translations.json`, 프롬프트 `prompts.json`은 유지했습니다. 전체 통합 데이터는 새 Release의 `prompt-notebook-data.json`, PC 원본 데이터는 `promptstudio-prompts.json`에서 내려받을 수 있습니다.

## 운영

로그인은 브라우저에서 동작하는 입장 확인 화면입니다. GitHub Pages·공개 저장소·Releases의 직접 파일 주소를 보호하는 서버 인증은 아닙니다. 아이디/비밀번호 원문은 코드에 저장하지 않지만, 정적 사이트이므로 비공개 접근 통제를 제공하지 않습니다.

외부 라이브러리 없는 정적 사이트이며 GitHub Pages에서 운영됩니다. 검증 시 사이트 파일 합계는 890,356,794바이트로 1GB 미만입니다. GitHub 유료 전환이나 API 결제 없이 동작합니다. 웹 미리보기는 가볍게 압축되어 있으며 보관 파일은 Releases에서 제공합니다.

로컬 실행: `python -m http.server 8765 --bind 127.0.0.1`

`scripts/migrate.py`는 최초 Reactor 보관용, `scripts/import_studio.py`는 로컬 PromptStudio 스냅샷 통합용입니다. 후자는 `output/studio-source/source.json`에 준비한 읽기 전용 데이터 사본과 PC 캐시를 사용합니다. `--catalog-only`는 기존 이미지 보관 기록을 이용해 카탈로그만 다시 만듭니다. 데이터 생성이 끝난 뒤 업로드하세요.

이미지·프롬프트의 권리는 원저작자에게 있습니다. 원본 운영자와 관계없는 개인 학습용 보관본이며, 원본 콘텐츠에 새 라이선스를 부여하지 않습니다. [원본 Reactor 사이트](https://reactor-prompts-magazine.pages.dev/)
