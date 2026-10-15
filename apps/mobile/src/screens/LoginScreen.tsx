import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { MobileController, MobileView } from "../state/controller";
import { UpdateSection } from "../features/updates/UpdateSection";
import type { MobileUpdateView } from "../features/updates/useMobileUpdate";

export function LoginScreen({ controller, view, update }: { controller: MobileController; view: MobileView; update: MobileUpdateView }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (view.challenge) void controller.challenge(code);
    else { void controller.login(username, password); setPassword(""); }
  };
  return <main className="login-page">
    <div className="login-hero">
      <div className="brand-mark" aria-hidden="true"><img src="/logo.svg" alt=""/></div>
      <h1>{t("title")}</h1>
      <p>{t("subtitle")}</p>
    </div>
    <form className="login-form" onSubmit={submit}>
      <h2>{t(view.challenge ? "challenge" : "loginTitle")}</h2>
      {view.challenge ? <>
        {view.challenge.message && <p>{view.challenge.message}</p>}
        {view.challenge.url && /^https:\/\//.test(view.challenge.url) && <a target="_blank" rel="noreferrer" href={view.challenge.url}>{t("openVerification")}</a>}
        <label>{t("verificationCode")}<input autoComplete="one-time-code" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} required/></label>
      </> : <>
        <label>{t("username")}<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} required/></label>
        <label>{t("password")}<input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/></label>
      </>}
      <button className="button-primary" disabled={view.busy} type="submit">
        {view.busy ? <LoaderCircle size={18} className="spin"/> : null}
        {t(view.busy ? "working" : view.challenge ? "verify" : "login")}
        {!view.busy && <ArrowRight size={18}/>}
      </button>
      {view.challenge && <button type="button" className="button-quiet" disabled={view.busy} onClick={() => controller.cancelChallenge()}>{t("cancel")}</button>}
      <p className="login-note"><LockKeyhole size={13}/>MirrorCoding</p>
    </form>
    {/* Updates stay reachable before sign-in, e.g. when an old release can no longer sign in. */}
    {Capacitor.isNativePlatform() && <div className="login-update"><UpdateSection update={update}/></div>}
  </main>;
}
