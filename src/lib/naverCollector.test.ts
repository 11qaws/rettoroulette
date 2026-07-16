import { describe, expect, it } from "vitest";

import {
  buildCollectorBookmarklet,
  parseImportHash,
  parseNaverCafeArticle,
} from "./naverCollector";

describe("parseNaverCafeArticle", () => {
  it("parses a current f-e Cafe article URL", () => {
    expect(
      parseNaverCafeArticle(
        "https://cafe.naver.com/f-e/cafes/31662960/articles/1105?boardtype=L&referrerAllArticles=true",
      ),
    ).toEqual({ cafeId: "31662960", articleId: "1105" });
  });

  it("parses an encoded legacy iframe_url_utf8 article URL", () => {
    expect(
      parseNaverCafeArticle(
        "https://cafe.naver.com/exchangeprj?iframe_url_utf8=%2FArticleRead.nhn%253Fclubid%253D31662960%2526articleid%253D1105%2526referrerAllArticles%253Dtrue",
      ),
    ).toEqual({ cafeId: "31662960", articleId: "1105" });
  });

  it("returns null for a URL without both article identifiers", () => {
    expect(parseNaverCafeArticle("https://cafe.naver.com/f-e/cafes/31662960/articles/nope")).toBeNull();
    expect(parseNaverCafeArticle("https://example.com/f-e/cafes/31662960/articles/1105")).toBeNull();
    expect(parseNaverCafeArticle("not a URL")).toBeNull();
  });
});

describe("parseImportHash", () => {
  it("decodes and normalizes a bookmarklet import payload", () => {
    const payload = {
      version: 1,
      source: "naver-cafe",
      cafeId: "31662960",
      articleId: "1105",
      collectedAt: "2026-07-17T00:00:00.000Z",
      candidates: [
        { id: "member-a", nick: "레또", reply: false },
        { id: "member-a", nick: "레또", reply: false },
        { id: "member-b", nick: "룰렛", reply: true },
      ],
      cookie: "this must not survive parsing",
    };

    const imported = parseImportHash(`#import=${encodeURIComponent(JSON.stringify(payload))}`);

    expect(imported).toEqual({
      version: 1,
      source: "naver-cafe",
      cafeId: "31662960",
      articleId: "1105",
      collectedAt: "2026-07-17T00:00:00.000Z",
      candidates: [
        { id: "member-a", nick: "레또", reply: false },
        { id: "member-b", nick: "룰렛", reply: true },
      ],
    });
  });

  it("rejects missing, malformed, and unrelated import hashes", () => {
    expect(parseImportHash("#mode=marble")).toBeNull();
    expect(parseImportHash("#import=%7Bbroken")).toBeNull();
    expect(
      parseImportHash(`#import=${encodeURIComponent(JSON.stringify({ source: "elsewhere" }))}`),
    ).toBeNull();
  });
});

describe("buildCollectorBookmarklet", () => {
  it("keeps collection in the signed-in Cafe page and never exports cookies", () => {
    const helper = buildCollectorBookmarklet("https://11qaws.github.io/rettoroulette/");

    expect(helper).toMatch(/^javascript:/);
    expect(helper).toContain("article.cafe.naver.com/gw/v4/cafes/");
    expect(helper).toContain('credentials:"include"');
    expect(helper).not.toContain("document.cookie");
  });
});
