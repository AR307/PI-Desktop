import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, TriangleAlert } from "lucide-react";

/** A failed history read never means the user's message should be resent. */
export function HistorySyncNotice({ error, connected, retry }: { error: string; connected: boolean; retry: () => Promise<void> }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [pending, setPending] = useState(false);
  const submit = async () => {
    setPending(true);
    try { await retry(); } finally { setPending(false); }
  };
  return <section className="banner error history-sync-notice" role="alert">
    <TriangleAlert size={17} className="banner-icon"/>
    <div className="banner-body">
      <span>{t("historySyncFailed")}</span>
      <details><summary>{t("historySyncDetails")}</summary><p>{error}</p></details>
      <span className="banner-actions"><button type="button" disabled={!connected || pending} onClick={() => void submit()}><RefreshCw size={14} className={pending ? "spin" : undefined}/>{t(pending ? "working" : "historySyncRetry")}</button></span>
    </div>
  </section>;
}
