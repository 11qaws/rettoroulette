/**
 * Only roulette-safe comment metadata crosses from Naver Cafe to this app.
 * Comment bodies, cookies, login tokens, and raw API responses are never kept.
 */
export interface NaverCafeArticle {
  cafeId: string;
  articleId: string;
}

export interface NaverCafeCandidate {
  id: string;
  nick: string;
  reply: boolean;
}

export interface NaverCafeImport {
  version: 1;
  source: 'naver-cafe';
  cafeId: string;
  articleId: string;
  collectedAt?: string;
  candidates: NaverCafeCandidate[];
}

const NUMERIC_ID = /^\d{1,20}$/;
const MAX_CANDIDATES = 25_000;
const MAX_NICK_LENGTH = 100;
const MAX_MEMBER_ID_LENGTH = 160;

function isNaverId(value: string | null): value is string {
  return value !== null && NUMERIC_ID.test(value);
}

function readArticleParams(params: URLSearchParams): NaverCafeArticle | null {
  const cafeId = params.get('clubid') ?? params.get('cafeId') ?? params.get('cafeid');
  const articleId = params.get('articleid') ?? params.get('articleId');

  if (!isNaverId(cafeId) || !isNaverId(articleId)) return null;
  return { cafeId, articleId };
}

function readArticlePath(pathname: string): NaverCafeArticle | null {
  const match = pathname.match(
    /\/(?:f-e\/|ca-fe\/web\/)?cafes\/(\d{1,20})\/articles\/(\d{1,20})(?:\/|$)/i,
  );

  return match ? { cafeId: match[1], articleId: match[2] } : null;
}

function decodeRepeatedly(value: string): string {
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

/** Supports current f-e URLs and legacy iframe_url_utf8 ArticleRead URLs. */
export function parseNaverCafeArticle(url: string): NaverCafeArticle | null {
  if (typeof url !== 'string' || url.trim() === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim(), 'https://cafe.naver.com');
  } catch {
    return null;
  }

  if (parsed.hostname !== 'cafe.naver.com' && parsed.hostname !== 'm.cafe.naver.com') {
    return null;
  }

  const articleFromPath = readArticlePath(parsed.pathname);
  if (articleFromPath) return articleFromPath;

  const articleFromQuery = readArticleParams(parsed.searchParams);
  if (articleFromQuery) return articleFromQuery;

  for (const key of ['iframe_url_utf8', 'iframe_url']) {
    const nestedUrl = parsed.searchParams.get(key);
    if (!nestedUrl) continue;

    try {
      const decodedUrl = decodeRepeatedly(nestedUrl);
      const nested = new URL(
        decodedUrl.startsWith('/') ? decodedUrl : `/${decodedUrl}`,
        'https://cafe.naver.com',
      );
      const nestedPath = readArticlePath(nested.pathname);
      if (nestedPath) return nestedPath;
      const nestedQuery = readArticleParams(nested.searchParams);
      if (nestedQuery) return nestedQuery;
    } catch {
      // An invalid legacy iframe URL is simply unsupported.
    }
  }

  return null;
}

function asSafeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCandidate(value: unknown): NaverCafeCandidate | null {
  if (!isRecord(value)) return null;

  const id = asSafeText(value.id, MAX_MEMBER_ID_LENGTH);
  const nick = asSafeText(value.nick, MAX_NICK_LENGTH);
  if (!id || !nick || typeof value.reply !== 'boolean') return null;

  return { id, nick, reply: value.reply };
}

function dedupeCandidates(candidates: NaverCafeCandidate[]): NaverCafeCandidate[] {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = `${candidate.id}\u0000${candidate.nick}\u0000${candidate.reply ? '1' : '0'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Safely accepts only the narrow import envelope emitted by the helper. */
export function parseImportHash(hash: string): NaverCafeImport | null {
  if (typeof hash !== 'string' || hash.length === 0) return null;

  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  const serialized = new URLSearchParams(value).get('import');
  if (!serialized) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (!isRecord(payload) || payload.source !== 'naver-cafe' || payload.version !== 1) {
    return null;
  }

  const cafeId = asSafeText(payload.cafeId, 20);
  const articleId = asSafeText(payload.articleId, 20);
  if (!NUMERIC_ID.test(cafeId) || !NUMERIC_ID.test(articleId) || !Array.isArray(payload.candidates)) {
    return null;
  }

  const candidates = dedupeCandidates(
    payload.candidates.slice(0, MAX_CANDIDATES).flatMap((candidate) => {
      const normalized = normalizeCandidate(candidate);
      return normalized ? [normalized] : [];
    }),
  );

  const collectedAt = asSafeText(payload.collectedAt, 80);
  return {
    version: 1,
    source: 'naver-cafe',
    cafeId,
    articleId,
    ...(collectedAt ? { collectedAt } : {}),
    candidates,
  };
}

function normalizeTargetUrl(targetUrl: string): string {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    throw new TypeError('targetUrl must be an absolute http(s) URL');
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new TypeError('targetUrl must use http or https');
  }

  return target.toString();
}

/**
 * Builds a drag-to-bookmarks helper. It runs on the signed-in Naver Cafe page,
 * so the browser keeps the existing Cafe session private. The imported payload
 * contains only comment writer nickname/id/reply state.
 */
export function buildCollectorBookmarklet(targetUrl: string): string {
  const safeTargetUrl = normalizeTargetUrl(targetUrl);
  const serializedTarget = JSON.stringify(safeTargetUrl);

  const script = String.raw`(async()=>{const T=__RETTO_TARGET__,A=(m)=>window.alert(m),I=(v)=>/^\d{1,20}$/.test(String(v||"")),P=(p)=>{const c=p.get("clubid")||p.get("cafeId")||p.get("cafeid"),a=p.get("articleid")||p.get("articleId");return I(c)&&I(a)?{cafeId:String(c),articleId:String(a)}:null},Q=(u)=>{try{const x=new URL(u,location.origin),m=x.pathname.match(/\/(?:f-e\/|ca-fe\/web\/)?cafes\/(\d{1,20})\/articles\/(\d{1,20})(?:\/|$)/i);if(m)return{cafeId:m[1],articleId:m[2]};const q=P(x.searchParams);if(q)return q;for(const k of["iframe_url_utf8","iframe_url"]){let v=x.searchParams.get(k);if(!v)continue;for(let i=0;i<3;i+=1){try{const n=decodeURIComponent(v);if(n===v)break;v=n}catch{break}}const n=new URL(v.startsWith("/")?v:"/"+v,location.origin),z=n.pathname.match(/\/(?:f-e\/|ca-fe\/web\/)?cafes\/(\d{1,20})\/articles\/(\d{1,20})(?:\/|$)/i),r=P(n.searchParams);if(z)return{cafeId:z[1],articleId:z[2]};if(r)return r}}catch{}return null};if(location.hostname!=="cafe.naver.com"){A("네이버 카페 게시글에서 실행해 주세요.");return}const R=Q(location.href);if(!R){A("게시글 번호를 찾지 못했어요. 카페 글 화면에서 다시 실행해 주세요.");return}const X=(v,n)=>typeof v==="string"||typeof v==="number"?String(v).trim().slice(0,n):"",C=(v,reply)=>{if(!v||typeof v!=="object")return null;const w=v.writer&&typeof v.writer==="object"?v.writer:{},id=X(w.memberId||w.id||v.memberId||v.writerId||v.commentId||v.id,160),nick=X(w.nick||w.nickname||v.nick||v.nickname||v.memberNickname,100),isReply=reply||v.isReply===true||!!(v.parentCommentId||v.parentCommentNo||v.refCommentNo);return id&&nick?{id,nick,reply:isReply}:null},W=(rows,reply,out)=>{for(const row of rows){const c=C(row,reply);if(c)out.push(c);if(row&&typeof row==="object")for(const k of["replies","replyList","childComments","comments"])if(Array.isArray(row[k]))W(row[k],true,out)}},F=async(page)=>{const u="https://article.cafe.naver.com/gw/v4/cafes/"+R.cafeId+"/articles/"+R.articleId+"/comments/pages/"+page+"?perPage=100&requestFrom=A&orderBy=asc",r=await fetch(u,{credentials:"include",headers:{accept:"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);const d=await r.json(),items=(d&&d.result&&d.result.comments&&d.result.comments.items)||(d&&d.comments&&d.comments.items)||(d&&d.result&&d.result.items);if(!Array.isArray(items))throw new Error("No comments");return{items,hasNext:!!(d&&d.result&&d.result.comments&&d.result.comments.hasNext)}};try{const raw=[];for(let page=1;page<=100;page+=1){const result=await F(page);W(result.items,false,raw);if(!result.hasNext||result.items.length<100)break}const seen=new Set(),candidates=raw.filter(c=>{const key=c.id+"\u0000"+c.nick+"\u0000"+(c.reply?"1":"0");if(seen.has(key))return false;seen.add(key);return true}),payload={version:1,source:"naver-cafe",cafeId:R.cafeId,articleId:R.articleId,collectedAt:new Date().toISOString(),candidates},json=JSON.stringify(payload),encoded=encodeURIComponent(json);if(encoded.length>6500){let copied=false;try{if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(json);copied=true}else{const t=document.createElement("textarea");t.value=json;t.style.position="fixed";t.style.opacity="0";document.body.appendChild(t);t.select();copied=document.execCommand("copy");t.remove()}}catch{}A(copied?"댓글 닉네임 "+candidates.length+"명을 복사했어요. Retto Roulette의 붙여넣기에 넣어 주세요.":"댓글 목록이 커서 자동 전달 대신 복사를 시도했어요. 클립보드 권한을 허용한 뒤 다시 실행해 주세요.");return}const to=new URL(T);to.hash="import="+encoded;const opened=window.open(to.toString(),"_blank","noopener,noreferrer");if(!opened)location.assign(to.toString())}catch(error){A("댓글을 가져오지 못했어요. 로그인 상태와 게시글 열람 권한을 확인해 주세요.")}})()`;

  return `javascript:${script
    .replace('__RETTO_TARGET__', serializedTarget)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')}`;
}
