import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, LockKeyhole } from "lucide-react";
import type { MobileController, MobileView } from "../state/controller";

export function Login({ controller, view }: { controller: MobileController; view: MobileView }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); if (view.challenge) void controller.challenge(code); else { void controller.login(username, password); setPassword(""); } };
  return <main className="login-page">
    <div className="brand-mark" aria-hidden="true">π</div>
    <h1>{t("title")}</h1><p className="muted">{t("subtitle")}</p>
    <form className="login-form" onSubmit={submit}>
      <h2>{t(view.challenge ? "challenge" : "loginTitle")}</h2>
      {view.challenge ? <>
        {view.challenge.message && <p>{view.challenge.message}</p>}
        {view.challenge.url && /^https:\/\//.test(view.challenge.url) && <a target="_blank" rel="noreferrer" href={view.challenge.url}>{t("openVerification")}</a>}
        <label>{t("verificationCode")}<input autoComplete="one-time-code" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} required /></label>
      </> : <>
        <label>{t("username")}<input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label>{t("password")}<input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      </>}
      <button className="primary" disabled={view.busy} type="submit">{t(view.busy ? "working" : view.challenge ? "verify" : "login")}<ArrowRight size={18}/></button>
      {view.challenge && <button type="button" disabled={view.busy} onClick={() => controller.cancelChallenge()}>{t("cancel")}</button>}
      <p className="login-note"><LockKeyhole size={14}/>MirrorCoding</p>
    </form>
  </main>;
}
