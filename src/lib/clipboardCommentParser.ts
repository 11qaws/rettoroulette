import type { NaverCafeCandidate } from './naverCollector';

const MAX_INPUT_BYTES = 3_000_000;
const MAX_CANDIDATES = 25_000;
const MAX_NICK_LENGTH = 100;
const COMMENT_ARRAY_KEYS = new Set(['comments', 'items', 'replylist', 'replies', 'childcomments']);
const REPLY_ARRAY_KEYS = new Set(['replylist', 'replies', 'childcomments']);
const COMMENT_MARKER_KEYS = new Set([
  'commentno',
  'commentid',
  'parentcommentid',
  'parentcommentno',
  'refcommentno',
  'isreply',
]);
const NOISE_LINE = /^(?:댓글|답글|답글쓰기|더보기|신고|수정|삭제|공감|좋아요|공유|등록|취소|목록|검색|카페s*홈|게시글|작성일|조회s*수?)$/;
const TIME_LINE = /^(?:(?:20\d{2}[./-]\s*\d{1,2}[./-]\s*\d{1,2}\.?\s*)?(?:오전|오후)?\s*\d{1,2}:\d{2}|20\d{2}[./-]\s*\d{1,2}[./-]\s*\d{1,2}\.?|방금\s*전|\d+\s*(?:초|분|시간|일)\s*전)$/;
const INLINE_TIME = /^(.*?)\s+(?:(?:20\d{2}[./-]\s*\d{1,2}[./-]\s*\d{1,2}\.?\s*)?(?:오전|오후)?\s*\d{1,2}:\d{2}|20\d{2}[./-]\s*\d{1,2}[./-]\s*\d{1,2}\.?|방금\s*전|\d+\s*(?:초|분|시간|일)\s*전)$/;

const PROFILE_PHOTO_LINE = /^프로필 사진$/;
const PROFILE_PHOTO_PREFIX = /^프로필 사진(?:인기멤버)?\s*/;
const COMMENT_COUNT_LINE = /^댓글\s*\d{1,3}(?:,\d{3})*$/;
const COMMENT_END_LINE = /^(?:댓글을 입력하세요|글쓰기목록(?:\s+TOP)?|전체글|전체보기|이 카페 인기글|페이징 이동)/;
const REPLY_PREFIX = /^(?:[ㄴ↳└]\s*|(?:답글|대댓글|댓글의 댓글|원댓글)\s*)/;
const COMMENT_MEDIA_LINE = /^(?:첨부사진|스티커)$/;
const MARKDOWN_COMMENT_AUTHOR = /^\[\*\*(.+?)\*\*\]\(https?:\/\/(?:[a-z0-9-]+\.)?cafe\.naver\.com\/[^)]*\)$/i;
const NUMBERED_REPLY_BODY = /^\d{1,4}(?:\s*\([^)]{0,80}\))?$/;

type UnknownRecord = Record<string, unknown>;

export interface ClipboardCommentImportOptions {
  /** 0 or undefined keeps every accepted commenter. */
  limit?: number;
  /** A local datetime-local value. Only dated comments at or before it remain. */
  before?: string;
}

type CopiedCommentRecord = {
  index: number;
  name: string;
  body: string;
  timestampKey: string | null;
  explicitReply: boolean;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bytesOf(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function safeText(value: unknown, maxLength = MAX_NICK_LENGTH) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function validNickname(value: string) {
  if (!value || value.length > MAX_NICK_LENGTH || NOISE_LINE.test(value) || TIME_LINE.test(value)) return false;
  if (/[\r\n<>]/.test(value)) return false;
  if (/^(?:https?:\/\/|www\.)/i.test(value)) return false;
  // Whole sentences are usually comment bodies; names almost never contain these.
  if (/[.!?。！？]/.test(value) || value.split(' ').length > 4) return false;
  return true;
}

function normalizeCandidate(id: unknown, nick: unknown, reply: boolean, order: number): NaverCafeCandidate | null {
  const name = safeText(nick);
  if (!validNickname(name)) return null;
  const memberId = safeText(id, 160) || `clipboard-${order}`;
  return { id: memberId, nick: name, reply };
}

function pushCandidate(
  candidates: NaverCafeCandidate[],
  seen: Set<string>,
  id: unknown,
  nick: unknown,
  reply: boolean,
) {
  if (candidates.length >= MAX_CANDIDATES) return;
  const candidate = normalizeCandidate(id, nick, reply, candidates.length + 1);
  if (!candidate) return;
  const key = candidate.nick.toLocaleLowerCase('ko-KR');
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push(candidate);
}

function candidateFromComment(record: UnknownRecord, inheritedReply: boolean, order: number) {
  const writer = isRecord(record.writer) ? record.writer : null;
  const profile = isRecord(record.profile) ? record.profile : null;
  const hasCommentMarker = Object.keys(record).some((key) => COMMENT_MARKER_KEYS.has(key.toLowerCase()));

  if (!writer && !hasCommentMarker) return null;
  const id = writer?.memberId ?? writer?.id ?? writer?.memberKey ?? record.memberId ?? record.writerId ?? profile?.memberId;
  const nick = writer?.nick ?? writer?.nickname ?? writer?.nickName ?? record.nick ?? record.nickname ?? record.memberNickname ?? profile?.nickname;
  const reply = inheritedReply || record.isReply === true || Boolean(record.parentCommentId ?? record.parentCommentNo ?? record.refCommentNo);
  return normalizeCandidate(id, nick, reply, order);
}

function walkCommentJson(
  value: unknown,
  candidates: NaverCafeCandidate[],
  seen: Set<string>,
  context: 'root' | 'comment' = 'root',
  inheritedReply = false,
  visited = { count: 0 },
) {
  if (visited.count > 50_000 || candidates.length >= MAX_CANDIDATES) return;
  visited.count += 1;

  if (Array.isArray(value)) {
    for (const item of value) walkCommentJson(item, candidates, seen, context, inheritedReply, visited);
    return;
  }
  if (!isRecord(value)) return;

  if (context === 'comment') {
    const candidate = candidateFromComment(value, inheritedReply, candidates.length + 1);
    if (candidate) {
      const key = candidate.nick.toLocaleLowerCase('ko-KR');
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate);
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (COMMENT_ARRAY_KEYS.has(normalizedKey)) {
      walkCommentJson(child, candidates, seen, 'comment', inheritedReply || REPLY_ARRAY_KEYS.has(normalizedKey), visited);
    } else if (isRecord(child)) {
      // Walk through response envelopes (result/data/etc.) until a comment
      // collection is found. A root post writer is never emitted because only
      // the `comment` context may produce a candidate.
      const childIsReply = inheritedReply || REPLY_ARRAY_KEYS.has(normalizedKey);
      walkCommentJson(child, candidates, seen, context, childIsReply, visited);
    }
  }
}

function tryJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function collectFromJsonSources(input: string, candidates: NaverCafeCandidate[], seen: Set<string>) {
  const direct = tryJson(input.trim());
  if (direct !== null) walkCommentJson(direct, candidates, seen);

  const scripts = input.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    const parsed = tryJson(script[1].trim());
    if (parsed !== null) walkCommentJson(parsed, candidates, seen);
  }
}

function collectFromHtmlAttributes(input: string, candidates: NaverCafeCandidate[], seen: Set<string>) {
  if (!/<[a-z][\s\S]*>/i.test(input)) return;
  if (typeof DOMParser === 'undefined') {
    const taggedNickname = /<[^>]*\bdata-(?:nickname|nick|member-nickname)=(['"])(.*?)\1[^>]*>/gi;
    for (const match of input.matchAll(taggedNickname)) {
      const nearbyMarkup = input.slice(Math.max(0, match.index - 1_200), match.index);
      if (!/\b(?:class|data-[\w-]+)=(['"])[^'"]*comment/i.test(nearbyMarkup) && !/\bdata-comment-writer=/i.test(match[0])) {
        continue;
      }
      const idMatch = match[0].match(/\bdata-member(?:-)?id=(['"])(.*?)\1/i);
      pushCandidate(candidates, seen, idMatch?.[2] ?? '', match[2], false);
    }
    const commentWriter = /<([a-z0-9]+)\b[^>]*\bclass=(['"])[^'"]*comment[^'"]*(?:writer|nick)[^'"]*\2[^>]*>([^<]+)<\/\1>/gi;
    for (const match of input.matchAll(commentWriter)) {
      pushCandidate(candidates, seen, '', match[3], false);
    }
    return;
  }
  const document = new DOMParser().parseFromString(input, 'text/html');
  const selectors = [
    '[data-nickname]',
    '[data-nick]',
    '[data-member-nickname]',
    '[data-comment-writer]',
    '[class*="comment"] [class*="nick"]',
    '[class*="comment"] [class*="writer"]',
  ];

  for (const element of document.querySelectorAll(selectors.join(','))) {
    const isCommentWriter = Boolean(
      element.closest('[class*="comment" i], [data-comment], [data-comment-writer]') ||
      element.hasAttribute('data-comment-writer'),
    );
    if (!isCommentWriter) continue;
    const name =
      element.getAttribute('data-nickname') ??
      element.getAttribute('data-nick') ??
      element.getAttribute('data-member-nickname') ??
      element.getAttribute('data-comment-writer') ??
      element.textContent;
    const id = element.getAttribute('data-member-id') ?? element.getAttribute('data-memberid') ?? '';
    pushCandidate(candidates, seen, id, name, false);
  }
}

function previousUsefulLine(lines: string[], from: number, commentStart: number) {
  for (let index = from; index >= commentStart && from - index < 4; index -= 1) {
    const value = safeText(lines[index]);
    if (!value || NOISE_LINE.test(value) || TIME_LINE.test(value)) continue;
    return value;
  }
  return '';
}

function nicknameKey(value: string) {
  return value.toLocaleLowerCase('ko-KR');
}

function timestampKey(value: string) {
  const match = value.match(/^(20\d{2})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})\.?\s*(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const period = match[4];
  let hour = Number(match[5]);
  const minute = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  if (period === '오전' && hour === 12) hour = 0;
  if (period === '오후' && hour < 12) hour += 12;

  return [year, month, day, hour, minute].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('');
}

function cutoffKey(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  return match ? match.slice(1).join('') : null;
}

function importLimit(options: ClipboardCommentImportOptions) {
  const limit = Math.floor(Number(options.limit ?? 0));
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

function nextCopiedNickname(lines: string[], start: number, end: number) {
  for (let index = start; index < Math.min(end, start + 3); index += 1) {
    const line = lines[index];
    if (!line || COMMENT_END_LINE.test(line) || PROFILE_PHOTO_LINE.test(line)) return null;
    const explicitReply = REPLY_PREFIX.test(line);
    const name = safeText(line.replace(REPLY_PREFIX, ''));
    if (!validNickname(name) || COMMENT_MEDIA_LINE.test(name)) return null;
    return { index, name, explicitReply };
  }
  return null;
}

function findArticleAuthor(lines: string[], commentStart: number) {
  let author = '';

  for (let index = 0; index < commentStart; index += 1) {
    const line = lines[index];
    if (!line.startsWith('프로필 사진')) continue;

    const inlineName = safeText(
      line
        .replace(PROFILE_PHOTO_PREFIX, '')
        .replace(/\s*님의 게시글 더보기.*$/, ''),
    );
    if (validNickname(inlineName) && !COMMENT_MEDIA_LINE.test(inlineName)) author = inlineName;

    if (line === '프로필 사진' || line.startsWith('프로필 사진인기멤버')) {
      const next = nextCopiedNickname(lines, index + 1, commentStart);
      if (next) author = next.name;
    }
  }

  return author;
}

function collectProfileComments(lines: string[], commentStart: number) {
  const records: CopiedCommentRecord[] = [];

  for (let profileIndex = commentStart; profileIndex < lines.length; profileIndex += 1) {
    const line = lines[profileIndex];
    if (COMMENT_END_LINE.test(line)) break;
    if (!PROFILE_PHOTO_LINE.test(line)) continue;

    const profile = nextCopiedNickname(lines, profileIndex + 1, lines.length);
    if (!profile) continue;

    let writtenAtIndex = -1;
    for (let index = profile.index + 1; index < lines.length; index += 1) {
      if (COMMENT_END_LINE.test(lines[index]) || PROFILE_PHOTO_LINE.test(lines[index])) break;
      if (TIME_LINE.test(lines[index])) {
        writtenAtIndex = index;
        break;
      }
    }
    if (writtenAtIndex < 0) continue;

    const body = lines
      .slice(profile.index + 1, writtenAtIndex)
      .filter((value) => value && !NOISE_LINE.test(value))
      .join(' ');
    records.push({
      index: profileIndex,
      name: profile.name,
      body,
      timestampKey: timestampKey(lines[writtenAtIndex]),
      explicitReply: profile.explicitReply,
    });
    profileIndex = writtenAtIndex;
  }

  return records;
}

function markdownCommentAuthor(line: string) {
  const match = line.match(MARKDOWN_COMMENT_AUTHOR);
  if (!match) return '';
  const name = safeText(match[1]);
  return validNickname(name) ? name : '';
}

function collectMarkdownComments(lines: string[], commentStart: number) {
  const records: CopiedCommentRecord[] = [];

  for (let authorIndex = commentStart; authorIndex < lines.length; authorIndex += 1) {
    const name = markdownCommentAuthor(lines[authorIndex]);
    if (!name) continue;

    let writtenAtIndex = -1;
    for (let index = authorIndex + 1; index < lines.length; index += 1) {
      if (COMMENT_END_LINE.test(lines[index]) || markdownCommentAuthor(lines[index])) break;
      if (TIME_LINE.test(lines[index])) {
        writtenAtIndex = index;
        break;
      }
    }
    if (writtenAtIndex < 0) continue;

    const body = lines
      .slice(authorIndex + 1, writtenAtIndex)
      .filter((value) => value && !NOISE_LINE.test(value))
      .join(' ');
    records.push({
      index: authorIndex,
      name,
      body,
      timestampKey: timestampKey(lines[writtenAtIndex]),
      explicitReply: REPLY_PREFIX.test(lines[authorIndex]),
    });
    authorIndex = writtenAtIndex;
  }

  return records;
}

function longestTimestampSequence(records: CopiedCommentRecord[], descending: boolean) {
  const tails: Array<{ key: number; index: number }> = [];
  const previous = new Array<number>(records.length).fill(-1);

  for (let index = 0; index < records.length; index += 1) {
    const timestamp = records[index].timestampKey;
    if (!timestamp) continue;

    const key = (descending ? -1 : 1) * Number(timestamp);
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (tails[middle].key <= key) low = middle + 1;
      else high = middle;
    }

    previous[index] = low > 0 ? tails[low - 1].index : -1;
    tails[low] = { key, index };
  }

  const indexes = new Set<number>();
  let cursor = tails.length > 0 ? tails[tails.length - 1].index : -1;
  while (cursor >= 0) {
    indexes.add(cursor);
    cursor = previous[cursor];
  }

  return { indexes, length: tails.length };
}

function likelyNumberReplyAuthors(records: CopiedCommentRecord[]) {
  const stats = new Map<string, { total: number; numbered: number }>();

  for (const record of records) {
    const key = nicknameKey(record.name);
    const stat = stats.get(key) ?? { total: 0, numbered: 0 };
    stat.total += 1;
    if (NUMBERED_REPLY_BODY.test(record.body.replace(/\s+/g, ' ').trim())) stat.numbered += 1;
    stats.set(key, stat);
  }

  return new Set(
    [...stats]
      .filter(([, stat]) => stat.total >= 4 && stat.numbered / stat.total >= 0.75)
      .map(([key]) => key),
  );
}

function originalRecordIndexesForReplyAuthors(
  records: CopiedCommentRecord[],
  parentIndexes: Set<number>,
  replyAuthors: Set<string>,
) {
  const originals = new Map<string, number>();

  records.forEach((record, index) => {
    const key = nicknameKey(record.name);
    if (!parentIndexes.has(index) || !replyAuthors.has(key)) return;
    if (NUMBERED_REPLY_BODY.test(record.body.replace(/\s+/g, ' ').trim())) return;

    const current = originals.get(key);
    if (current === undefined) {
      originals.set(key, index);
      return;
    }

    const currentRecord = records[current];
    const currentTime = currentRecord.timestampKey ?? '999999999999';
    const nextTime = record.timestampKey ?? '999999999999';
    if (nextTime.localeCompare(currentTime) < 0 || (nextTime === currentTime && record.index < currentRecord.index)) {
      originals.set(key, index);
    }
  });

  return originals;
}

function collectStructuredCopiedText(
  lines: string[],
  commentStart: number,
  candidates: NaverCafeCandidate[],
  seen: Set<string>,
  options: ClipboardCommentImportOptions,
) {
  const profileRecords = collectProfileComments(lines, commentStart);
  const markdownRecords = collectMarkdownComments(lines, commentStart);
  const records = markdownRecords.length > profileRecords.length ? markdownRecords : profileRecords;
  if (records.length === 0) return false;

  const ascending = longestTimestampSequence(records, false);
  const descending = longestTimestampSequence(records, true);
  const parentIndexes = ascending.length >= descending.length ? ascending.indexes : descending.indexes;
  // A relative-time comment cannot be placed reliably in a chronological chain;
  // keep it unless another explicit reply signal rejects it.
  records.forEach((record, index) => {
    if (!record.timestampKey) parentIndexes.add(index);
  });

  const articleAuthor = nicknameKey(findArticleAuthor(lines, commentStart));
  const replyAuthors = likelyNumberReplyAuthors(records);
  const replyAuthorOriginals = originalRecordIndexesForReplyAuthors(records, parentIndexes, replyAuthors);
  const before = cutoffKey(options.before);
  const limit = importLimit(options);
  const sorted = records
    .filter((record, index) => {
      const key = nicknameKey(record.name);
      const isReplyAgentResponse = replyAuthors.has(key) && replyAuthorOriginals.get(key) !== index;
      return parentIndexes.has(index) && !record.explicitReply && key !== articleAuthor && !isReplyAgentResponse;
    })
    .filter((record) => !before || (record.timestampKey !== null && record.timestampKey <= before))
    .sort((left, right) => {
      const leftTime = left.timestampKey ?? '999999999999';
      const rightTime = right.timestampKey ?? '999999999999';
      return leftTime.localeCompare(rightTime) || left.index - right.index;
    });

  let imported = 0;
  for (const record of sorted) {
    if (limit > 0 && imported >= limit) break;
    const beforePush = candidates.length;
    pushCandidate(candidates, seen, `clipboard-${record.index}`, record.name, false);
    if (candidates.length > beforePush) imported += 1;
  }

  return true;
}

function collectFromCopiedText(
  input: string,
  candidates: NaverCafeCandidate[],
  seen: Set<string>,
  options: ClipboardCommentImportOptions,
) {
  if (/<[a-z][\s\S]*>/i.test(input)) return;

  const lines = input
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map((line) => safeText(line, 180));
  const marker = lines.findIndex((line) => COMMENT_COUNT_LINE.test(line));
  const commentStart = marker >= 0 ? marker + 1 : 0;
  if (collectStructuredCopiedText(lines, commentStart, candidates, seen, options)) return;

  for (let index = commentStart; index < lines.length; index += 1) {
    const line = lines[index];
    const inline = line.match(INLINE_TIME);
    if (inline && validNickname(safeText(inline[1]))) {
      pushCandidate(candidates, seen, `clipboard-${index}`, inline[1], false);
      continue;
    }
    if (!TIME_LINE.test(line)) continue;
    pushCandidate(candidates, seen, `clipboard-${index}`, previousUsefulLine(lines, index - 1, commentStart), false);
  }
}

/**
 * Extracts only commenter identifiers from data the user explicitly pasted.
 * Parsing stays in the browser; the original page text is never uploaded.
 */
export function extractNaverCafeCommentAuthors(
  input: string,
  options: ClipboardCommentImportOptions = {},
): NaverCafeCandidate[] {
  if (typeof input !== 'string' || input.trim() === '' || bytesOf(input) > MAX_INPUT_BYTES) return [];

  const candidates: NaverCafeCandidate[] = [];
  const seen = new Set<string>();
  collectFromJsonSources(input, candidates, seen);
  collectFromHtmlAttributes(input, candidates, seen);
  collectFromCopiedText(input, candidates, seen, options);
  const limit = importLimit(options);
  return limit > 0 ? candidates.slice(0, limit) : candidates;
}
