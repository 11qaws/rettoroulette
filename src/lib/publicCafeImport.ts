import { parseImportHash, parseNaverCafeArticle } from './naverCollector';
import type { NaverCafeImport } from './naverCollector';

type PublicImportErrorCode =
  | 'IMPORT_API_NOT_CONFIGURED'
  | 'INVALID_ARTICLE_URL'
  | 'ARTICLE_NOT_PUBLIC'
  | 'ACCESS_DENIED'
  | string;

export class PublicCafeImportError extends Error {
  code: PublicImportErrorCode;

  constructor(code: PublicImportErrorCode, message: string) {
    super(message);
    this.name = 'PublicCafeImportError';
    this.code = code;
  }
}

function apiBase() {
  const configured = import.meta.env.VITE_CAFE_API_BASE_URL?.trim();
  if (!configured) {
    throw new PublicCafeImportError(
      'IMPORT_API_NOT_CONFIGURED',
      '댓글 수집 서버가 아직 연결되지 않았어요.',
    );
  }
  return configured.replace(/\/$/, '');
}

function parsePayload(value: unknown): NaverCafeImport {
  const parsed = parseImportHash(`#import=${encodeURIComponent(JSON.stringify(value))}`);
  if (!parsed) {
    throw new PublicCafeImportError('INVALID_RESULT', '댓글 작성자 목록 형식을 확인하지 못했어요.');
  }
  return parsed;
}

export async function importPublicCafeAuthors(url: string): Promise<NaverCafeImport> {
  if (!parseNaverCafeArticle(url)) {
    throw new PublicCafeImportError('INVALID_ARTICLE_URL', '네이버 카페 게시글 주소를 확인해 주세요.');
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}/v1/cafe-authors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new PublicCafeImportError('NETWORK_ERROR', '댓글 수집 서버에 연결하지 못했어요.');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PublicCafeImportError('INVALID_RESPONSE', '댓글 수집 서버 응답을 확인하지 못했어요.');
  }

  if (!response.ok) {
    const error = typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
    throw new PublicCafeImportError(
      typeof error?.code === 'string' ? error.code : 'IMPORT_FAILED',
      typeof error?.message === 'string' ? error.message : '댓글 작성자를 가져오지 못했어요.',
    );
  }

  return parsePayload(body);
}
