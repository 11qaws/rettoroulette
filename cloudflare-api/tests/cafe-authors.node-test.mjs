import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequest, parseNaverCafeUrl } from '../functions/v1/cafe-authors.js';

test('current f-e and legacy iframe Cafe URLs are accepted', () => {
  assert.deepEqual(
    parseNaverCafeUrl(
      'https://cafe.naver.com/f-e/cafes/31662960/articles/1105?boardtype=L&referrerAllArticles=true',
    ),
    { cafeId: '31662960', articleId: '1105' },
  );
  assert.deepEqual(
    parseNaverCafeUrl(
      'https://cafe.naver.com/exchangeprj?iframe_url_utf8=%2FArticleRead.nhn%253Fclubid%253D31662960%2526articleid%253D1105',
    ),
    { cafeId: '31662960', articleId: '1105' },
  );
  assert.equal(parseNaverCafeUrl('https://example.com/f-e/cafes/31662960/articles/1105'), null);
});

test('POST returns only a safe, deduplicated author envelope', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    assert.match(String(url), /article\.cafe\.naver\.com\/gw\/v4\/cafes\/31662960\/articles\/1105\/comments\/pages\/1/);
    return new Response(
      JSON.stringify({
        result: {
          comments: {
            hasNext: false,
            items: [
              { writer: { memberId: 'alice', nick: '앨리스' } },
              { writer: { memberId: 'alice', nick: '앨리스' } },
              {
                writer: { memberId: 'bob', nick: '밥' },
                replies: [{ writer: { memberId: 'alice', nick: '앨리스' } }],
              },
            ],
          },
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };

  const request = new Request('https://api.example.test/v1/cafe-authors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://11qaws.github.io',
      'CF-Connecting-IP': '203.0.113.10',
    },
    body: JSON.stringify({
      url: 'https://cafe.naver.com/f-e/cafes/31662960/articles/1105',
    }),
  });
  const response = await onRequest({ request });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://11qaws.github.io');
  assert.deepEqual(body.candidates, [
    { id: 'alice', nick: '앨리스', reply: false },
    { id: 'bob', nick: '밥', reply: false },
    { id: 'alice', nick: '앨리스', reply: true },
  ]);
  assert.deepEqual(Object.keys(body).sort(), [
    'articleId',
    'cafeId',
    'candidates',
    'collectedAt',
    'source',
    'version',
  ]);
});

test('member-only 403 returns ARTICLE_NOT_PUBLIC without exposing Naver data', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        result: {
          errorCode: '4004',
          reason: '카페 멤버만 읽을 수 있는 게시글입니다.',
        },
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );

  const request = new Request('https://api.example.test/v1/cafe-authors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.11',
    },
    body: JSON.stringify({
      url: 'https://cafe.naver.com/f-e/cafes/31662960/articles/1105',
    }),
  });
  const response = await onRequest({ request });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'ARTICLE_NOT_PUBLIC',
      message: '이 글은 카페 멤버 전용 또는 비공개 글이라 가져올 수 없어요. 권한을 우회하지 않습니다.',
    },
  });
});
