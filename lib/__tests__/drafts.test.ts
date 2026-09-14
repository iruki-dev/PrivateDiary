import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllDrafts, clearDraft, loadDraft, saveDraft } from "../drafts";

/**
 * The vitest environment here is "node" (vitest.config.ts), so there is no
 * window/localStorage. This is the smallest stub that behaves like the real
 * one for what lib/drafts.ts uses, including key()/length enumeration.
 */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("window", { localStorage });
  return store;
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveDraft / loadDraft", () => {
  it("round-trips a draft for one uid", () => {
    saveDraft("alice", "쓰다 만 일기");
    expect(loadDraft("alice")?.text).toBe("쓰다 만 일기");
  });

  it("keeps drafts separate per account so signing in as someone else shows nothing", () => {
    saveDraft("alice", "앨리스의 일기");
    expect(loadDraft("bob")).toBeNull();
  });

  it("removes the draft instead of storing an empty or whitespace-only one", () => {
    saveDraft("alice", "내용");
    saveDraft("alice", "   ");
    expect(loadDraft("alice")).toBeNull();
  });

  it("returns null for stored junk rather than throwing", () => {
    window.localStorage.setItem("privatediary:draft:v1:alice", "{not json");
    expect(loadDraft("alice")).toBeNull();
  });

  it("falls back to the current time when the stored timestamp is unusable", () => {
    window.localStorage.setItem(
      "privatediary:draft:v1:alice",
      JSON.stringify({ text: "내용", savedAt: "not-a-date" })
    );
    expect(loadDraft("alice")?.savedAt.getTime()).not.toBeNaN();
  });

  it("survives storage being unavailable (private window, blocked site data)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
        key: () => null,
        length: 0,
      },
    });

    expect(() => saveDraft("alice", "내용")).not.toThrow();
    expect(loadDraft("alice")).toBeNull();
    expect(() => clearDraft("alice")).not.toThrow();
    expect(() => clearAllDrafts()).not.toThrow();
  });
});

describe("clearDraft / clearAllDrafts", () => {
  it("clearDraft removes only that account's draft", () => {
    saveDraft("alice", "앨리스");
    saveDraft("bob", "밥");
    clearDraft("alice");

    expect(loadDraft("alice")).toBeNull();
    expect(loadDraft("bob")?.text).toBe("밥");
  });

  it("clearAllDrafts removes every account's draft on this device", () => {
    saveDraft("alice", "앨리스");
    saveDraft("bob", "밥");
    clearAllDrafts();

    expect(loadDraft("alice")).toBeNull();
    expect(loadDraft("bob")).toBeNull();
  });

  it("clearAllDrafts leaves unrelated localStorage keys alone", () => {
    saveDraft("alice", "앨리스");
    window.localStorage.setItem("some-other-app", "keep me");
    clearAllDrafts();

    expect(window.localStorage.getItem("some-other-app")).toBe("keep me");
  });
});
