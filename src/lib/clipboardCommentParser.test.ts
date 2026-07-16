import { describe, expect, it } from 'vitest';

import { extractNaverCafeCommentAuthors } from './clipboardCommentParser';

describe('extractNaverCafeCommentAuthors', () => {
  it('keeps only writers from a comment JSON response and marks replies', () => {
    const input = JSON.stringify({
      result: {
        comments: {
          items: [
            {
              commentId: 'c-1',
              writer: { memberId: 'member-1', nick: '말랑콩' },
              replies: [
                {
                  commentId: 'c-2',
                  writer: { memberId: 'member-2', nickname: '구름냥' },
                },
              ],
            },
            {
              commentId: 'c-3',
              writer: { memberId: 'member-1', nick: '말랑콩' },
            },
          ],
        },
      },
      writer: { memberId: 'post-writer', nick: '본문작성자' },
    });

    expect(extractNaverCafeCommentAuthors(input)).toEqual([
      { id: 'member-1', nick: '말랑콩', reply: false },
      { id: 'member-2', nick: '구름냥', reply: true },
    ]);
  });

  it('reads obvious comment nickname attributes from pasted HTML', () => {
    const html = `
      <article><span data-nickname="본문작성자">본문작성자</span></article>
      <section class="comment-area">
        <span data-member-id="m-1" data-nickname="딸기우유">딸기우유</span>
        <span class="comment-writer">민트초코</span>
      </section>
    `;

    expect(extractNaverCafeCommentAuthors(html)).toEqual([
      { id: 'm-1', nick: '딸기우유', reply: false },
      { id: 'clipboard-2', nick: '민트초코', reply: false },
    ]);
  });

  it('marks nested reply markup without guessing from timestamps', () => {
    const html = `
      <section class="comment-item" data-comment-id="root-1">
        <span data-member-id="member-1" data-nickname="사악한고래밥">사악한고래밥</span>
      </section>
      <section class="comment-item comment-item--reply" data-parent-comment-id="root-1">
        <span data-member-id="member-2" data-nickname="번호 답글">번호 답글</span>
      </section>
      <section class="comment-item" data-comment-id="root-2">
        <span data-member-id="member-3" data-nickname="POPO">POPO</span>
      </section>
    `;

    expect(extractNaverCafeCommentAuthors(html)).toEqual([
      { id: 'member-1', nick: '사악한고래밥', reply: false },
      { id: 'member-2', nick: '번호 답글', reply: true },
      { id: 'member-3', nick: 'POPO', reply: false },
    ]);
  });

  it('uses name-before-time records from Ctrl+A copied page text', () => {
    const copied = `
      게시글 제목
      댓글 3
      말랑콩
      2026. 07. 17. 12:34
      첫 댓글입니다
      구름냥 오후 1:02
      답글쓰기
      딸기우유
      3분 전
      반가워요
    `;

    expect(extractNaverCafeCommentAuthors(copied)).toEqual([
      { id: 'clipboard-4', nick: '말랑콩', reply: false },
      { id: 'clipboard-6', nick: '구름냥', reply: false },
      { id: 'clipboard-9', nick: '딸기우유', reply: false },
    ]);
  });

  it('keeps image-only and long copied comment blocks', () => {
    const profilePhoto = '프로필 사진';
    const copied = [
      `${profilePhoto}인기멤버`,
      '아모레또',
      '댓글 3',
      profilePhoto,
      '사악한고래밥',
      '첨부사진',
      '2026.07.16. 21:56',
      '답글쓰기',
      profilePhoto,
      '답글 번호 답글',
      '1',
      '2026.07.16. 23:19',
      '답글쓰기',
      profilePhoto,
      '사이버싸이코',
      '첨부사진',
      '2026.07.16. 22:04',
      '답글쓰기',
      profilePhoto,
      '답글 번호 답글',
      '2',
      '2026.07.16. 23:20',
      '답글쓰기',
      profilePhoto,
      'POPO',
      '레또님 부기 말고 전신 삼면도 나 디자인 시트 올려주실 수 있나요 ㅠㅠ',
      '데뷔 방송 때 올려주신다고한거같은데 아무리 찾아도 안보여서요 ㅠㅠ',
      '디자인 보기가 좀 힘드네요ㅠㅠ',
      '2026.07.16. 22:34',
      '답글쓰기',
      '댓글을 입력하세요',
    ].join('\n');

    expect(extractNaverCafeCommentAuthors(copied).map((candidate) => candidate.nick)).toEqual([
      '사악한고래밥',
      '사이버싸이코',
      'POPO',
    ]);
  });

  it('excludes comments that are explicitly marked as replies in copied text', () => {
    const profilePhoto = '\uD504\uB85C\uD544 \uC0AC\uC9C4';
    const copied = [
      `${profilePhoto}\uC778\uAE30\uBA64\uBC84`,
      'Host',
      '\uB313\uAE00 9',
      profilePhoto,
      'Player A',
      'gift please',
      '2026.07.16. 21:56',
      '\uB2F5\uAE00\uC4F0\uAE30',
      profilePhoto,
      '답글 Reply Agent',
      '1',
      '2026.07.16. 23:19',
      '\uB2F5\uAE00\uC4F0\uAE30',
      profilePhoto,
      'Player B',
      'gift please',
      '2026.07.16. 21:57',
      '\uB2F5\uAE00\uC4F0\uAE30',
      profilePhoto,
      '답글 Reply Agent',
      '2',
      '2026.07.16. 23:20',
      '\uB2F5\uAE00\uC4F0\uAE30',
      profilePhoto,
      'Player C',
      'gift please',
      '2026.07.16. 21:58',
      '\uB2F5\uAE00\uC4F0\uAE30',
      profilePhoto,
      '답글 Reply Agent',
      '3',
      '2026.07.16. 23:21',
      '\uB2F5\uAE00\uC4F0\uAE30',
      profilePhoto,
      'Player D',
      'gift please',
      '2026.07.16. 21:59',
      '\uB2F5\uAE00\uC4F0\uAE30',
      profilePhoto,
      '답글 Reply Agent',
      '4',
      '2026.07.16. 23:22',
      '\uB2F5\uAE00\uC4F0\uAE30',
      profilePhoto,
      'Host',
      'sorry',
      '2026.07.16. 23:23',
      '\uB2F5\uAE00\uC4F0\uAE30',
      '\uB313\uAE00\uC744 \uC785\uB825\uD558\uC138\uC694',
    ].join('\n');

    expect(extractNaverCafeCommentAuthors(copied)).toEqual([
      { id: 'clipboard-3', nick: 'Player A', reply: false },
      { id: 'clipboard-13', nick: 'Player B', reply: false },
      { id: 'clipboard-23', nick: 'Player C', reply: false },
      { id: 'clipboard-33', nick: 'Player D', reply: false },
    ]);

    expect(extractNaverCafeCommentAuthors(copied, {
      before: '2026-07-16T21:57',
      limit: 1,
    })).toEqual([
      { id: 'clipboard-3', nick: 'Player A', reply: false },
    ]);
  });

  it('reads linked clipboard authors, including photo-only original comments', () => {
    const commentUrl = 'https://cafe.naver.com/ca-fe/cafes/31662960/articles/1105#';
    const author = (name: string) => `[**${name}**](${commentUrl})`;
    const replyButton = `[\uB2F5\uAE00\uC4F0\uAE30](${commentUrl})`;
    const copied = [
      author('Reply Agent'),
      '\uCCA8\uBD80\uC0AC\uC9C4',
      '2026.07.16. 21:56',
      replyButton,
      author('Player A'),
      'gift please',
      '2026.07.16. 21:57',
      replyButton,
      author('Reply Agent'),
      '1',
      '2026.07.16. 23:19',
      replyButton,
      author('Player B'),
      'gift please',
      '2026.07.16. 21:58',
      replyButton,
      author('Reply Agent'),
      '2',
      '2026.07.16. 23:20',
      replyButton,
      author('POPO'),
      'a long multi-line parent comment',
      '2026.07.16. 22:34',
      replyButton,
      author('Reply Agent'),
      '3',
      '2026.07.16. 23:21',
      replyButton,
      author('Cyber Photo'),
      '\uCCA8\uBD80\uC0AC\uC9C4',
      '2026.07.16. 22:35',
      replyButton,
      author('Reply Agent'),
      '4',
      '2026.07.16. 23:22',
      replyButton,
    ].join('\n');

    expect(extractNaverCafeCommentAuthors(copied)).toEqual([
      { id: 'clipboard-0', nick: 'Reply Agent', reply: false },
      { id: 'clipboard-4', nick: 'Player A', reply: false },
      { id: 'clipboard-12', nick: 'Player B', reply: false },
      { id: 'clipboard-20', nick: 'POPO', reply: false },
      { id: 'clipboard-28', nick: 'Cyber Photo', reply: false },
    ]);
  });

  it('recognizes the relative-time phrase for a simple copied record', () => {
    const copied = '\uB313\uAE00 1\nMint\n\uBC29\uAE08 \uC804';

    expect(extractNaverCafeCommentAuthors(copied)).toEqual([
      { id: 'clipboard-2', nick: 'Mint', reply: false },
    ]);
  });
});
