# Reactor Prompt Archive

[갤러리 열기](https://byeonghoyoo.github.io/reactor-prompts-magazine/) · [원본 이미지 ZIP](https://github.com/byeonghoyoo/reactor-prompts-magazine/releases/tag/snapshot-2026-10-17) · [원본 사이트](https://reactor-prompts-magazine.pages.dev)

2026년 10월 17일 공개 페이지의 이미지와 AI 프롬프트를 보관한 개인 학습용 아카이브입니다. 원본 운영자와 관련이 없으며, 이미지와 프롬프트의 권리는 원저작자에게 있습니다.

## 보관 범위

| 항목 | 수량 |
| --- | ---: |
| 게시물 데이터 | 4,361개 |
| 프롬프트가 있는 게시물 | 3,042개 |
| 원본에 등록된 이미지 | 18,527장 |
| 내려받아 보관한 이미지 | 16,011장 |
| 원본 서버에서 제공되지 않은 이미지 | 2,516장 |
| 썸네일 포함 보관 파일 | 19,725개 |

원본 서버의 404/410 응답으로 내려받지 못한 파일은 [missing-images.json](missing-images.json)에 URL과 상태를 기록했습니다. 해당 게시물과 프롬프트는 삭제하지 않고 보존했습니다.

## 이미지와 프롬프트 받기

- **원본 이미지**: [GitHub 릴리스](https://github.com/byeonghoyoo/reactor-prompts-magazine/releases/tag/snapshot-2026-10-17)의 ZIP 8개. 각 ZIP을 독립적으로 풀 수 있습니다. 원본 파일은 재압축하거나 수정하지 않았습니다. 총 6.35 GiB입니다.
- **웹 미리보기**: `previews/`의 WebP 파일입니다. 최대 960픽셀로 축소해 GitHub Pages에서 열람할 수 있게 했습니다.
- **전체 프롬프트**: [prompts.json](prompts.json). 프롬프트가 없는 게시물은 빈 문자열로 보존합니다.
- **원본 데이터**: [source/gallery-data.json](source/gallery-data.json), [source/translations.json](source/translations.json). 한국어·영어·일본어·중국어 번역 데이터를 포함합니다.
- **무결성 기록**: [image-manifest.json](image-manifest.json)에 원본 URL, SHA-256, 크기, 보관 ZIP, 미리보기 경로가 있습니다.

## 검증

ZIP에 들어 있는 원본 19,725개를 SHA-256으로 전수 확인하고, 미리보기 19,725개를 실제 디코딩했습니다. 프롬프트는 원본 데이터와 문자열 단위로 비교했습니다.

[검증 상세](QA_REPORT.md) · [검증 결과 JSON](validation-results.json) · [이전 요약](migration-summary.json)

## 로컬 실행

```powershell
python -m http.server 8765
```

브라우저에서 `http://localhost:8765`를 열면 됩니다. 갤러리 자체는 빌드 과정이나 외부 라이브러리 CDN이 필요하지 않습니다.

`scripts/migrate.py`는 Python 3.11 이상과 `requests`, `Pillow`를 사용하는 수집 스크립트입니다. 자동 실행 일정은 설정하지 않았습니다. 다시 실행하면 보관된 진행 기록을 확인하고 필요한 파일을 이어서 수집합니다.
