/**
 * Retto Roulette public Naver Cafe author importer.
 *
 * This endpoint deliberately makes unauthenticated requests only. It never
 * receives browser cookies, login tokens, comment bodies, or raw Naver data.
 */

const ALLOWED_ORIGINS = new Set([
  'https://11qaws.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const NAVER_CAFE_HOSTS = new Set(['cafe.naver.com', 'm.cafe.naver.com']);
const NUMERIC_ID = /^\d{1,20}$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const MAX_CANDIDATES = 5_000;
const MAX_NODES_PER_PAGE = 1_500;
const MAX_UPSTREAM_BYTES = 1_250_000;
const MAX_REQUEST_BYTES = 4_096;
const MAX_URL_LENGTH = 2_048;
const UPSTREAM_TIMEOUT_MS = 8_000;
const COLLECTION_TIMEOUT_MS = 25_000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const MAX_RATE_LIMIT_KEYS = 1_024;
const NESTED_REPLY_KEYS = ['replies', 'replyList', 'childComments', 'comments'];

// Best-effort burst protection per running isolate. Use Cloudflare WAF/Rate
// Limiting in production when a durable, account-wide policy is required.
const recentRequests = new Map();

class ApiError extends Error {
  constructor(code, status, message, headers = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.headers = headers;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNaverId(value) {
  return typeof value === 'string' && NUMERIC_ID.test(value);
}

function safeText(value, maxLength) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maxLength);
}

function decodeRepeatedly(value) {
  let decoded = value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }

  return decoded;
}

function articleFromCurrentPath(pathname) {
  const match = pathname.match(
    /\/(?:f-e\/|ca-fe\/web\/)?cafes\/(\d{1,20})\/articles\/(\d{1,20})(?:\/|$)/i,
  );

  return match ? { cafeId: match[1], articleId: match[2] } : null;
}

function articleFromLegacyUrl(url) {
  if (!/\/ArticleRead\.nhn$/i.test(url.pathname)) return null;

  const cafeId = url.searchParams.get('clubid') ?? url.searchParams.get('cafeId');
  const articleId = url.searchParams.get('articleid') ?? url.searchParams.get('articleId');

  return isNaverId(cafeId) && isNaverId(articleId) ? { cafeId, articleId } : null;
}

function isNaverCafeUrl(url) {
  return url.protocol === 'https:' && NAVER_CAFE_HOSTS.has(url.hostname);
}

function parseArticleUrl(url, allowNested) {
  if (!isNaverCafeUrl(url)) return null;

  const current = articleFromCurrentPath(url.pathname);
  if (current) return current;

  const legacy = articleFromLegacyUrl(url);
  if (legacy) return legacy;

  if (!allowNested) return null;

  for (const key of ['iframe_url_utf8', 'iframe_url']) {
    const rawNestedUrl = url.searchParams.get(key);
    if (!rawNestedUrl) continue;

    try {
      const nested = new URL(decodeRepeatedly(rawNestedUrl), 'https://cafe.naver.com/');
      const parsed = parseArticleUrl(nested, false);
      if (parsed) return parsed;
    } catch {
      // An invalid legacy iframe URL is simply unsupported.
    }
  }

  return null;
}

/** Supports current f-e links and legacy iframe_url(_utf8) ArticleRead links. */
export function parseNaverCafeUrl(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_URL_LENGTH) {
    return null;
  }

  try {
    return parseArticleUrl(new URL(value.trim()), true);
  } catch {
    return null;
  }
}

function requestedOrigin(request) {
  const origin = request.headers.get('Origin');
  return origin === null ? null : origin.trim();
}

function corsHeaders(origin) {
  const headers = new Headers({
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  });

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function jsonResponse(payload, status, origin, extraHeaders = {}) {
  const headers = corsHeaders(origin);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');

  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(payload), { status, headers });
}

function errorResponse(origin, code, status, message, extraHeaders) {
  return jsonResponse({ error: { code, message } }, status, origin, extraHeaders);
}

function getRateLimitKey(request) {
  return request.headers.get('CF-Connecting-IP')?.trim() || 'anonymous';
}

function pruneRecentRequests(now) {
  if (recentRequests.size <= MAX_RATE_LIMIT_KEYS) return;

  for (const [key, requestedAt] of recentRequests) {
    if (now - requestedAt >= RATE_LIMIT_WINDOW_MS) recentRequests.delete(key);
  }
}

function takeRateLimitSlot(request) {
  const now = Date.now();
  pruneRecentRequests(now);

  const key = getRateLimitKey(request);
  const previousRequestAt = recentRequests.get(key);
  if (typeof previousRequestAt === 'number') {
    const elapsed = now - previousRequestAt;
    if (elapsed < RATE_LIMIT_WINDOW_MS) {
      return Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1_000));
    }
  }

  recentRequests.set(key, now);
  return 0;
}

async function readImportRequest(request) {
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new ApiError('REQUEST_TOO_LARGE', 413, '요청이 너무 큽니다. 카페 글 링크만 보내 주세요.');
  }

  let bodyText;
  try {
    bodyText = await request.text();
  } catch {
    throw new ApiError('INVALID_REQUEST', 400, '요청 본문을 읽을 수 없어요.');
  }

  if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) {
    throw new ApiError('REQUEST_TOO_LARGE', 413, '요청이 너무 큽니다. 카페 글 링크만 보내 주세요.');
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new ApiError('INVALID_REQUEST', 400, 'JSON 형식의 { "url": "..." } 요청이 필요해요.');
  }

  if (!isRecord(body) || typeof body.url !== 'string') {
    throw new ApiError('INVALID_REQUEST', 400, '카페 글 링크(url)를 보내 주세요.');
  }

  const article = parseNaverCafeUrl(body.url);
  if (!article) {
    throw new ApiError(
      'INVALID_CAFE_URL',
      400,
      '네이버 카페의 현재 글 링크 또는 예전 ArticleRead 링크만 사용할 수 있어요.',
    );
  }

  return article;
}

function commentEndpoint(cafeId, articleId, page) {
  const url = new URL(
    `https://article.cafe.naver.com/gw/v4/cafes/${cafeId}/articles/${articleId}/comments/pages/${page}`,
  );
  url.search = new URLSearchParams({
    perPage: String(PAGE_SIZE),
    requestFrom: 'A',
    orderBy: 'asc',
  }).toString();
  return url;
}

function collectErrorText(data) {
  if (!isRecord(data)) return '';

  const result = isRecord(data.result) ? data.result : null;
  const fields = [
    data.errorCode,
    data.reason,
    data.message,
    result?.errorCode,
    result?.reason,
    result?.message,
  ];

  return fields
    .filter((field) => typeof field === 'string' || typeof field === 'number')
    .map((field) => String(field))
    .join(' ');
}

function isMemberOnlyResult(data) {
  const errorText = collectErrorText(data);
  return (
    /(?:^|\s)4004(?:\s|$)/.test(errorText) ||
    /카페\s*멤버만|멤버만\s*읽을|회원만|비공개|공개되지\s*않/i.test(errorText)
  );
}

function isAccessDeniedResult(data) {
  return /권한|인증|로그인|접근\s*거부|forbidden|unauthorized/i.test(collectErrorText(data));
}

function extractCommentPage(data) {
  if (!isRecord(data)) return null;

  const result = isRecord(data.result) ? data.result : null;
  const candidates = [
    result && isRecord(result.comments) ? result.comments : null,
    isRecord(data.comments) ? data.comments : null,
    result,
  ];

  for (const candidate of candidates) {
    if (!isRecord(candidate) || !Array.isArray(candidate.items)) continue;

    return {
      items: candidate.items,
      hasNext:
        typeof candidate.hasNext === 'boolean'
          ? candidate.hasNext
          : candidate.items.length === PAGE_SIZE,
    };
  }

  return null;
}

async function fetchCommentPage(cafeId, articleId, page, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(commentEndpoint(cafeId, articleId, page), {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: abortController.signal,
    });
  } catch {
    throw new ApiError('UPSTREAM_UNAVAILABLE', 502, '네이버 댓글 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  } finally {
    clearTimeout(timeoutId);
  }

  const advertisedLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_UPSTREAM_BYTES) {
    throw new ApiError('UPSTREAM_RESPONSE_TOO_LARGE', 502, '댓글 응답이 너무 커서 안전하게 처리할 수 없어요.');
  }

  let rawBody;
  try {
    rawBody = await response.text();
  } catch {
    throw new ApiError('UPSTREAM_UNAVAILABLE', 502, '네이버 댓글 응답을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_UPSTREAM_BYTES) {
    throw new ApiError('UPSTREAM_RESPONSE_TOO_LARGE', 502, '댓글 응답이 너무 커서 안전하게 처리할 수 없어요.');
  }

  let data = null;
  try {
    data = JSON.parse(rawBody);
  } catch {
    // A non-JSON 401/403 response is still reported as a permission failure below.
  }

  if (isMemberOnlyResult(data)) {
    throw new ApiError(
      'ARTICLE_NOT_PUBLIC',
      403,
      '이 글은 카페 멤버 전용 또는 비공개 글이라 가져올 수 없어요. 권한을 우회하지 않습니다.',
    );
  }

  if (response.status === 401 || response.status === 403 || isAccessDeniedResult(data)) {
    throw new ApiError(
      'ACCESS_DENIED',
      403,
      '네이버가 이 서버의 공개 접근을 허용하지 않았어요. 공개 글인지 확인해 주세요.',
    );
  }

  if (response.status === 404) {
    throw new ApiError('ARTICLE_NOT_FOUND', 404, '카페 글 또는 댓글 정보를 찾을 수 없어요. 링크를 확인해 주세요.');
  }

  if (!response.ok) {
    throw new ApiError('UPSTREAM_UNAVAILABLE', 502, '네이버 댓글 서버가 요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }

  const commentPage = extractCommentPage(data);
  if (!commentPage) {
    throw new ApiError(
      'UPSTREAM_INVALID_RESPONSE',
      502,
      '네이버 댓글 응답 형식을 확인할 수 없어요. 공개 글인지 다시 확인해 주세요.',
    );
  }

  return commentPage;
}

function candidateFromComment(comment, inheritedReply) {
  if (!isRecord(comment)) return null;

  const writer = isRecord(comment.writer) ? comment.writer : {};
  const profile = isRecord(comment.profile) ? comment.profile : {};
  const id = safeText(
    writer.memberId ?? writer.id ?? writer.memberKey ?? comment.memberId ?? comment.writerId ?? profile.memberId,
    160,
  );
  const nick = safeText(
    writer.nick ??
      writer.nickname ??
      writer.nickName ??
      comment.nick ??
      comment.nickname ??
      comment.memberNickname ??
      profile.nickname,
    100,
  );

  if (!id || !nick) return null;

  return {
    id,
    nick,
    reply:
      inheritedReply ||
      comment.isReply === true ||
      Boolean(comment.parentCommentId ?? comment.parentCommentNo ?? comment.refCommentNo),
  };
}

function appendCandidates(items, candidates, seen) {
  const queue = items.map((item) => ({ item, inheritedReply: false }));
  let visitedNodes = 0;

  while (queue.length > 0) {
    const { item, inheritedReply } = queue.shift();
    visitedNodes += 1;
    if (visitedNodes > MAX_NODES_PER_PAGE) {
      throw new ApiError('RESULT_LIMIT_EXCEEDED', 422, '댓글 또는 대댓글 수가 많아 안전 한도를 넘었어요.');
    }

    const candidate = candidateFromComment(item, inheritedReply);
    if (candidate) {
      const key = `${candidate.id}\u0000${candidate.nick}\u0000${candidate.reply ? '1' : '0'}`;
      if (!seen.has(key)) {
        if (candidates.length >= MAX_CANDIDATES) {
          throw new ApiError('RESULT_LIMIT_EXCEEDED', 422, '댓글 작성자가 5,000명을 넘어 안전 한도를 넘었어요.');
        }
        seen.add(key);
        candidates.push(candidate);
      }
    }

    if (!isRecord(item)) continue;
    for (const key of NESTED_REPLY_KEYS) {
      const replies = item[key];
      if (!Array.isArray(replies)) continue;
      for (const reply of replies) queue.push({ item: reply, inheritedReply: true });
    }
  }
}

async function collectAuthors(article) {
  const candidates = [];
  const seen = new Set();
  let hasNext = true;
  const deadline = Date.now() + COLLECTION_TIMEOUT_MS;

  for (let page = 1; page <= MAX_PAGES && hasNext; page += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new ApiError('COLLECTION_TIMEOUT', 504, '댓글 수집 시간이 길어져 중단했어요. 잠시 뒤 다시 시도해 주세요.');
    }

    const result = await fetchCommentPage(
      article.cafeId,
      article.articleId,
      page,
      Math.min(UPSTREAM_TIMEOUT_MS, remainingMs),
    );
    appendCandidates(result.items, candidates, seen);

    if (result.hasNext && result.items.length === 0) {
      throw new ApiError('UPSTREAM_INVALID_RESPONSE', 502, '댓글 페이지 정보가 올바르지 않아요. 잠시 뒤 다시 시도해 주세요.');
    }

    hasNext = result.hasNext;
  }

  if (hasNext) {
    throw new ApiError('RESULT_LIMIT_EXCEEDED', 422, '댓글 페이지가 50개를 넘어 안전 한도를 넘었어요.');
  }

  return candidates;
}

/** Cloudflare Pages route: POST /v1/cafe-authors */
export async function onRequest(context) {
  const { request } = context;
  const origin = requestedOrigin(request);

  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return errorResponse(null, 'ORIGIN_NOT_ALLOWED', 403, '허용되지 않은 웹사이트 요청입니다.');
  }

  if (request.method === 'OPTIONS') {
    if (origin === null) {
      return errorResponse(null, 'ORIGIN_REQUIRED', 400, '브라우저 출처를 확인할 수 없어요.');
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return errorResponse(origin, 'METHOD_NOT_ALLOWED', 405, 'POST 요청만 사용할 수 있어요.', {
      Allow: 'POST, OPTIONS',
    });
  }

  try {
    const article = await readImportRequest(request);
    const retryAfter = takeRateLimitSlot(request);
    if (retryAfter > 0) {
      return errorResponse(origin, 'RATE_LIMITED', 429, '잠시 뒤 다시 시도해 주세요.', {
        'Retry-After': String(retryAfter),
      });
    }

    const candidates = await collectAuthors(article);
    return jsonResponse(
      {
        version: 1,
        source: 'naver-cafe',
        cafeId: article.cafeId,
        articleId: article.articleId,
        collectedAt: new Date().toISOString(),
        candidates,
      },
      200,
      origin,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(origin, error.code, error.status, error.message, error.headers);
    }

    return errorResponse(origin, 'INTERNAL_ERROR', 500, '댓글을 가져오는 중 오류가 발생했어요. 잠시 뒤 다시 시도해 주세요.');
  }
}
