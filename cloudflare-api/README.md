# Retto Roulette · Cafe Authors API

공개로 열리는 네이버 카페 글의 **댓글 작성자 정보만** Retto Roulette에 전달하는 Cloudflare Pages Functions입니다.

- 로그인, 쿠키, 네이버 계정 정보, 댓글 본문을 받거나 저장하지 않습니다.
- 서버는 네이버의 공개 댓글 응답에서 `id`, `nick`, `reply`만 남기고 원본 응답은 버립니다.
- 멤버 전용·비공개 글, 401/403 응답은 우회하지 않고 오류로 끝냅니다.
- 결과도 `Cache-Control: no-store`로 반환합니다.

## API 계약

`POST /v1/cafe-authors`

요청 본문:

```json
{
  "url": "https://cafe.naver.com/f-e/cafes/31662960/articles/1105"
}
```

허용하는 링크는 현재 네이버 카페 `f-e/cafes/{cafeId}/articles/{articleId}` 형식과 예전 `ArticleRead.nhn?clubid=...&articleid=...` 형식(래핑된 `iframe_url_utf8` 포함)입니다.

성공 응답은 프런트엔드의 기존 import 형식과 동일하며, 이 필드 외의 데이터는 포함하지 않습니다.

```json
{
  "version": 1,
  "source": "naver-cafe",
  "cafeId": "31662960",
  "articleId": "1105",
  "collectedAt": "2026-07-17T00:00:00.000Z",
  "candidates": [
    { "id": "member-id", "nick": "닉네임", "reply": false }
  ]
}
```

실패 형식:

```json
{
  "error": {
    "code": "ARTICLE_NOT_PUBLIC",
    "message": "이 글은 카페 멤버 전용 또는 비공개 글이라 가져올 수 없어요. 권한을 우회하지 않습니다."
  }
}
```

주요 오류 코드는 `INVALID_CAFE_URL`, `ARTICLE_NOT_PUBLIC`, `ACCESS_DENIED`, `ARTICLE_NOT_FOUND`, `RATE_LIMITED`, `RESULT_LIMIT_EXCEEDED`입니다. `ARTICLE_NOT_PUBLIC`은 네이버의 멤버 전용 응답(예: `4004`) 또는 비공개 표시를 뜻하고, 일반 401/403은 `ACCESS_DENIED`로 구분합니다.

## 안전 한도와 CORS

- 한 요청은 댓글 페이지 50개(페이지당 100개), 고유 후보 5,000명, 페이지 응답 1.25 MB, 전체 수집 시간 25초까지만 처리합니다. 초과하면 부분 명단을 반환하지 않고 `RESULT_LIMIT_EXCEEDED` 또는 `COLLECTION_TIMEOUT`으로 종료합니다.
- 같은 요청자는 실행 인스턴스 기준 10초에 한 번만 수집할 수 있습니다. 전역 정책이 필요하면 Cloudflare WAF/Rate Limiting 규칙을 추가하세요.
- 브라우저 CORS는 `https://11qaws.github.io`, `http://localhost:5173`, `http://127.0.0.1:5173`만 허용합니다. 쿠키를 받지 않으므로 `Access-Control-Allow-Credentials`를 사용하지 않습니다.
- 이 API는 공개 접근만 확인합니다. 네이버 로그인이나 회원 권한을 전달·재현·우회하지 않습니다.

## 로컬 확인

Cloudflare Pages Functions는 프로젝트 루트의 `functions/` 폴더를 경로로 사용합니다. 이 저장소에서는 `functions/v1/cafe-authors.js`가 `/v1/cafe-authors`가 됩니다.

```powershell
cd cloudflare-api
npm test
npx wrangler pages dev public
```

다른 터미널에서:

```powershell
$body = @{ url = 'https://cafe.naver.com/f-e/cafes/31662960/articles/1105' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://localhost:8788/v1/cafe-authors' -ContentType 'application/json' -Body $body
```

예시 글이 멤버 전용이면 의도대로 `ARTICLE_NOT_PUBLIC`이 반환됩니다. 실제 공개 글로 바꿔 성공 응답도 확인하세요.

## Cloudflare Pages 배포

Cloudflare Dashboard의 드래그 앤 드롭 방식은 `functions/` 폴더를 컴파일하지 않으므로, 이 API는 Wrangler 또는 Git 연동으로 배포해야 합니다.

```powershell
cd cloudflare-api
npx wrangler login
npx wrangler pages project create retto-roulette-api
npx wrangler pages deploy public --project-name retto-roulette-api
```

배포가 끝나면 API 주소는 다음처럼 됩니다.

```text
https://retto-roulette-api.pages.dev/v1/cafe-authors
```

Retto Roulette 프런트엔드에는 이 **기본 주소**를 `VITE_CAFE_API_BASE_URL`로 설정하고, 호출 시 `/v1/cafe-authors`를 붙입니다. 이 폴더에는 비밀값이 없으며 별도 환경 변수도 필요하지 않습니다.

Cloudflare Pages Functions의 파일 기반 라우팅과 `wrangler pages dev`/`wrangler pages deploy` 흐름은 [Cloudflare Pages Functions 문서](https://developers.cloudflare.com/pages/functions/)를 따릅니다.
