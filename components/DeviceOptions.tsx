"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/contexts/AccountContext";
import { listBackups, type BackupSummary } from "@/lib/store/backup";
import { Icon } from "./Icon";

const backupTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });

/**
 * The Android app's ways in that don't go through the server, under the
 * login form:
 *
 *  - Each account backed up on this phone (lib/store/backup.ts) — readable
 *    with its diary passphrase even when signing in is impossible, which
 *    is exactly when it is needed.
 *  - The fully local diary (/local): no account, no server at all.
 */
export function DeviceOptions() {
  const { openBackup } = useAccount();
  const [backups, setBackups] = useState<BackupSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    listBackups()
      .then((list) => {
        if (!cancelled) setBackups(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-3">
      {backups.length > 0 && (
        <div className="card space-y-3">
          <div className="space-y-0.5">
            <h2 className="text-[1.0625rem] font-bold">휴대폰 백업</h2>
            <p className="muted text-sm">로그인할 수 없을 때도 일기 암호로 읽을 수 있어요. 새로 쓸 수는 없어요.</p>
          </div>
          <ul className="space-y-2">
            {backups.map((backup) => (
              <li key={backup.uid}>
                <button
                  type="button"
                  // The login page then moves on to the diary (its signed-in redirect).
                  onClick={() => openBackup(backup.uid, backup.label)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-fill px-4 py-3 text-left transition-colors hover:bg-pill focus:outline-none focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <Icon name="phone" size={20} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{backup.label}</span>
                    <span className="block text-[0.8125rem] text-ink-3 tabular-nums">
                      일기 {backup.entryCount.toLocaleString("ko-KR")}개 · {backupTime.format(backup.updatedAt)}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={18} className="shrink-0 text-ink-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link
        href="/local"
        className="flex items-center gap-3 rounded-2xl bg-surface px-5 py-4 transition-colors hover:bg-fill focus:outline-none focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Icon name="lock" size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">서버 없이 이 휴대폰에만 쓰기</span>
          <span className="block text-[0.8125rem] text-ink-3">계정 없이, 인터넷을 끊은 채로 일기장을 써요</span>
        </span>
        <Icon name="chevron-right" size={18} className="shrink-0 text-ink-4" />
      </Link>
    </div>
  );
}
