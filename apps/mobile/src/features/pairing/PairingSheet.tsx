import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { MobileController, MobileView } from "../../state/controller";
import { Surface } from "../../ui/Sheet";

/** Claim an eight-digit code; a failure stays beside the code and keeps other pairings. */
export function PairingSheet({ open, close, controller, view }: { open: boolean; close(): void; controller: MobileController; view: MobileView }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [code, setCode] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (open) { setCode(""); setFailed(false); } }, [open]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (view.busy || code.length !== 8) return;
    await controller.pair(code);
    if (controller.getSnapshot().error) { setFailed(true); return; }
    setCode(""); close();
  };
  return <Surface open={open} title={t("pair")} onClose={close} footer={<div className="surface-actions">
    <button type="button" onClick={close}>{t("cancel")}</button>
    <button type="submit" form="pair-form" className="button-primary" disabled={view.busy || code.length !== 8}>{t(view.busy ? "working" : "pairSubmit")}</button>
  </div>}>
    <form id="pair-form" onSubmit={(event) => void submit(event)}>
      <label>{t("pairCode")}<input className="pair-code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8} pattern="[0-9]{8}" value={code}
        onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); setFailed(false); }}/></label>
      {failed && view.error && <p className="error-text pair-error" role="alert">{t(view.error, { defaultValue: t("request_failed") })}</p>}
    </form>
    <p className="pair-hint">{t("pairHint")}</p>
  </Surface>;
}
