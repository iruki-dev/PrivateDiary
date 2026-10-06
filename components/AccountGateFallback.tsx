"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@/contexts/AccountContext";
import { useSeed } from "@/contexts/SeedContext";
import { getBackupSummary, type BackupSummary } from "@/lib/store/backup";
import { IS_ANDROID_APP } from "@/lib/platform";
import { LoadingScreen } from "./LoadingState";
import { Icon } from "./Icon";

const backupTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });

/**
 * What a page shows while useAccountGate() isn't ready: the usual loading
 * screen — or, when the diary's key record couldn't be read (no internet,
 * the server down), what happened and what to do, instead of spinning
 * forever. In the Android app, if this account is backed up on the phone
 * (lib/store/backup.ts), its copy can be opened from here.
 */
export function AccountGateFallback() {
  const { account, openBackup } = useAccount();
  const { loadError, refresh } = useSeed();
  const [retrying, setRetrying] = useState(false);
  const [backup, setBackup] = useState<BackupSummary | null>(null);
  const cloudId = account?.kind === "cloud" ? account.id : null;

  useEffect(() => {
    if (!loadError || !cloudId || !IS_ANDROID_APP) return;
    let cancelled = false;
    getBackupSummary(cloudId)
      .then((summary) => {
        if (!cancelled) setBackup(summary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loadError, cloudId]);

  if (!loadError) return <LoadingScreen />;

  async function retry() {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center px-5 pb-10 pt-6 sm:px-6 sm:py-16">
      <div className="card w-full max-w-md space-y-4" role="alert">
        <div className="flex gap-3">
          <Icon name="alert-circle" size={22} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-[1.0625rem] font-bold">일기장을 불러오지 못했어요</p>
            <p className="muted text-sm">
              {account?.kind === "cloud"
                ? "일기는 그대로 있어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
                : "일기는 그대로 있어요. 다시 시도해 주세요."}
              {backup && " 이 휴대폰에 백업해 둔 일기장은 지금 바로 읽을 수 있어요."}
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <button type="button" onClick={() => void retry()} disabled={retrying} className="btn-primary w-full">
            {retrying ? "다시 시도하는 중…" : "다시 시도"}
          </button>
          {backup && cloudId && (
            <button
              type="button"
              onClick={() => openBackup(cloudId, backup.label)}
              className="btn-secondary w-full"
            >
              <Icon name="phone" size={18} />
              휴대폰 백업 열기 · {backupTime.format(backup.updatedAt)}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
