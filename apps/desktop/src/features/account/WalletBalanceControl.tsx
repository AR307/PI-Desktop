import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MIRRORCODING_ORIGIN, type MirrorCodingBenefits } from "@pi-desktop/shared";
import { Button, TooltipButton } from "../../components/ui";
import { api } from "../../lib/api";
import { AccountDialog } from "./AccountDialog";
import "./account.css";

const WALLET_URL = MIRRORCODING_ORIGIN + "/wallet";

export function WalletBalanceControl({
  data,
  onOpen,
}: {
  data?: MirrorCodingBenefits;
  onOpen(): void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const balance =
    data?.walletRead && data.walletBalance !== null && data.quotaPerYuan !== null
      ? new Intl.NumberFormat(i18n.language, {
          style: "currency",
          currency: "CNY",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(data.walletBalance / data.quotaPerYuan)
      : null;
  const label = balance === null
    ? t("accountBenefits.walletUnavailable")
    : t("accountBenefits.walletBalance", { amount: balance });
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.browserOpenExternal(WALLET_URL);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <TooltipButton
        className="mc-wallet-trigger"
        tooltip={label}
        ariaLabel={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          onOpen();
          setFailed(false);
          setOpen(true);
        }}
      >
        {balance ?? t("accountBenefits.walletUnknown")}
      </TooltipButton>
      {open && (
        <AccountDialog
          title={t("accountBenefits.walletConfirmTitle")}
          onCancel={() => { if (!busy) setOpen(false); }}
        >
          <p>{t("accountBenefits.walletConfirmDescription")}</p>
          <p>{WALLET_URL}</p>
          {failed && (
            <p className="mirrorcoding-error" role="alert">
              {t("accountBenefits.walletOpenFailed")}
            </p>
          )}
          <div className="mirrorcoding-actions">
            <Button variant="ghost" autoFocus disabled={busy} onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
              {t("accountBenefits.walletOpen")}
            </Button>
          </div>
        </AccountDialog>
      )}
    </>
  );
}
