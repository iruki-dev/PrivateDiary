import { describe, expect, it } from "vitest";
import { buildExportFile } from "../export";
import {
  entriesFromUnlockedExport,
  importAllowance,
  InvalidImportFileError,
  parseImportFile,
  planImport,
} from "../import";
import { lockExport, unlockExport } from "@/lib/crypto";

const exported = [
  { id: "a", entrySeq: 1, createdAt: new Date("2025-03-01T09:00:00.123Z"), text: "첫 일기" },
  { id: "b", entrySeq: 2, createdAt: new Date("2025-03-02T21:30:00.000Z"), text: "둘째 날\n바닷가" },
  { id: "c", entrySeq: 3, createdAt: null, text: "시각 미확정" },
];

describe("parseImportFile", () => {
  it("reads back exactly what the JSON export wrote", () => {
    const file = buildExportFile(exported, "json");
    const parsed = parseImportFile(file.content);
    expect(parsed.kind).toBe("plain");
    if (parsed.kind !== "plain") return;
    expect(parsed.entries).toEqual([
      { createdAt: exported[0].createdAt, text: "첫 일기" },
      { createdAt: exported[1].createdAt, text: "둘째 날\n바닷가" },
      { createdAt: null, text: "시각 미확정" },
    ]);
  });

  it("recognises a locked export, whose inside is the same JSON", async () => {
    const plain = buildExportFile(exported, "json").content;
    const locked = JSON.stringify(await lockExport(plain, "file password words"));
    const parsed = parseImportFile(locked);
    expect(parsed.kind).toBe("locked");
    if (parsed.kind !== "locked") return;
    const opened = await unlockExport(parsed.file, "file password words");
    expect(entriesFromUnlockedExport(opened)).toHaveLength(3);
  });

  it("refuses the Markdown export and anything else", () => {
    expect(() => parseImportFile(buildExportFile(exported, "markdown").content)).toThrow(InvalidImportFileError);
    expect(() => parseImportFile("{}")).toThrow(InvalidImportFileError);
    expect(() => parseImportFile(JSON.stringify({ format: "privatediary-export", version: 1, entries: [{ text: 3 }] }))).toThrow(
      InvalidImportFileError
    );
    expect(() =>
      parseImportFile(
        JSON.stringify({ format: "privatediary-export", version: 1, entries: [{ text: "x", createdAt: "not a date" }] })
      )
    ).toThrow(InvalidImportFileError);
  });

  it("skips empty entries and tolerates a byte-order mark", () => {
    const content = `﻿${JSON.stringify({
      format: "privatediary-export",
      version: 1,
      entries: [{ text: "   ", createdAt: null }, { text: "남는 것", createdAt: null }],
    })}`;
    const parsed = parseImportFile(content);
    expect(parsed.kind === "plain" && parsed.entries.map((e) => e.text)).toEqual(["남는 것"]);
  });
});

describe("planImport", () => {
  const incoming = [
    { createdAt: new Date("2025-03-02T21:30:00.000Z"), text: "둘째 날" },
    { createdAt: new Date("2025-03-01T09:00:00.000Z"), text: "첫 일기" },
    { createdAt: null, text: "언제인지 모름" },
    { createdAt: new Date("2025-03-01T09:00:00.000Z"), text: "첫 일기" },
  ];

  it("skips what the diary already has and repeats inside the file, oldest first", () => {
    const plan = planImport([{ createdAt: new Date("2025-03-02T21:30:00.000Z"), text: "둘째 날" }], incoming);
    expect(plan.skipped).toBe(2);
    expect(plan.toAdd.map((e) => e.text)).toEqual(["첫 일기", "언제인지 모름"]);
  });

  it("treats the same text at a different moment as a different entry", () => {
    const plan = planImport([{ createdAt: new Date("2025-03-03T00:00:00.000Z"), text: "둘째 날" }], incoming.slice(0, 1));
    expect(plan.toAdd).toHaveLength(1);
  });

  it("matches Korean text whatever its Unicode form", () => {
    const nfd = "한글".normalize("NFD");
    const when = new Date("2025-01-01T00:00:00.000Z");
    expect(planImport([{ createdAt: when, text: "한글" }], [{ createdAt: when, text: nfd }]).skipped).toBe(1);
  });

  it("importing the same file twice adds nothing the second time", () => {
    const first = planImport([], incoming);
    const second = planImport(first.toAdd, incoming);
    expect(second.toAdd).toHaveLength(0);
  });
});

describe("importAllowance", () => {
  it("leaves room under the account's daily limit, or none needed", () => {
    expect(importAllowance(100, 30)).toBe(70);
    expect(importAllowance(10, 30)).toBe(0);
    expect(importAllowance(0, 500)).toBe(Infinity);
  });
});
