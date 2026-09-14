import { describe, expect, it } from "vitest";
import { buildExportFile, type ExportableEntry } from "../export";

const AT = new Date(2026, 8, 14, 9, 58);

function entry(overrides: Partial<ExportableEntry> = {}): ExportableEntry {
  return {
    id: "e1",
    entrySeq: 1,
    createdAt: new Date(2026, 8, 14, 9, 0),
    text: "오늘은 좋은 하루였다.",
    ...overrides,
  };
}

describe("buildExportFile", () => {
  it("names the file by export date and picks the right mime type", () => {
    expect(buildExportFile([entry()], "markdown", AT)).toMatchObject({
      filename: "privatediary-2026-09-14.md",
      mimeType: "text/markdown;charset=utf-8",
    });
    expect(buildExportFile([entry()], "json", AT)).toMatchObject({
      filename: "privatediary-2026-09-14.json",
      mimeType: "application/json;charset=utf-8",
    });
  });

  it("orders entries oldest-first by entrySeq, not by the order passed in", () => {
    const { content } = buildExportFile(
      [
        entry({ id: "c", entrySeq: 3, text: "셋째" }),
        entry({ id: "a", entrySeq: 1, text: "첫째" }),
        entry({ id: "b", entrySeq: 2, text: "둘째" }),
      ],
      "json",
      AT
    );

    const parsed = JSON.parse(content) as { entries: { text: string }[] };
    expect(parsed.entries.map((e) => e.text)).toEqual(["첫째", "둘째", "셋째"]);
  });

  it("sorts by entrySeq even when a timestamp has not resolved yet", () => {
    const { content } = buildExportFile(
      [entry({ entrySeq: 2, createdAt: null, text: "나중" }), entry({ entrySeq: 1, text: "먼저" })],
      "json",
      AT
    );

    const parsed = JSON.parse(content) as { entries: { text: string; createdAt: string | null }[] };
    expect(parsed.entries.map((e) => e.text)).toEqual(["먼저", "나중"]);
    expect(parsed.entries[1].createdAt).toBeNull();
  });

  it("states in both formats that the archive is not encrypted", () => {
    expect(buildExportFile([entry()], "markdown", AT).content).toContain("암호화되어 있지 않습니다");
    expect(JSON.parse(buildExportFile([entry()], "json", AT).content).warning).toContain(
      "NOT encrypted"
    );
  });

  it("keeps entry text verbatim, including newlines", () => {
    const text = "첫 줄\n\n셋째 줄";
    const { content } = buildExportFile([entry({ text })], "json", AT);
    expect(JSON.parse(content).entries[0].text).toBe(text);
    expect(buildExportFile([entry({ text })], "markdown", AT).content).toContain(text);
  });

  it("produces a valid, empty archive when there are no entries", () => {
    const parsed = JSON.parse(buildExportFile([], "json", AT).content);
    expect(parsed.entryCount).toBe(0);
    expect(parsed.entries).toEqual([]);
  });
});
