import { useState } from "react";
import { useTranslation } from "react-i18next";

/** A failed history read never means the user's message should be resent. */
export function HistorySyncNotice({ error, connected, retry }: { error: string; connected: boolean; retry: () => Promise<void> }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [pending, setPending] = useState(false);
  const submit = async () => {
    setPending(true);
    try { await retry(); } finally { setPending(false); }
  };
  return <section className="notice error history-sync-notice" role="alert">
    <div><p>{t("historySyncFailed")}</p><details><summary>{t("historySyncDetails")}</summary><p>{error}</p></details></div>
    <button type="button" disabled={!connected || pending} onClick={() => void submit()}>{t(pending ? "working" : "historySyncRetry")}</button>
  </section>;
}
