import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { RacpApprovalRequest, RacpInputRequest } from "@pi-desktop/shared";
import type { MobileController } from "../state/controller";
import { Markdown } from "./Markdown";

export function Approval({ request, controller, markdown }: { request: RacpApprovalRequest; controller: MobileController; markdown?: string }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [busy, setBusy] = useState(false);
  return <section className="action-card"><h3>{request.title ?? t("permission")}</h3><Markdown>{markdown ?? request.summary}</Markdown>{request.question && <p>{request.question}</p>}<div className="button-row">{request.allowedDecisions.filter((decision) => decision !== "allow-session").map((decision) => <button disabled={busy} className={decision === "allow-once" || decision === "approve" ? "primary" : ""} key={decision} onClick={async () => { setBusy(true); await controller.approve(request.id, decision); setBusy(false); }}>{t(decision === "approve" ? "approvePlan" : decision === "reject" ? "rejectPlan" : decision === "deny" ? "reject" : "approve")}</button>)}</div></section>;
}

export function Question({ request, controller }: { request: RacpInputRequest; controller: MobileController }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [selected, setSelected] = useState<Record<string, string[]>>({}); const [free, setFree] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); await controller.answer(request.id, request.questions.map((question) => { const answers = [...(selected[question.id] ?? []), ...(free[question.id]?.trim() ? [free[question.id].trim()] : [])]; return answers.length ? answers : null; })); setBusy(false); };
  return <form className="action-card" onSubmit={submit}><h3>{t("question")}</h3>{request.questions.map((question) => <fieldset key={question.id}><legend>{question.question}</legend>{question.options.map((option) => <label className="option" key={option}><input type={question.multiSelect ? "checkbox" : "radio"} name={question.id} checked={(selected[question.id] ?? []).includes(option)} onChange={(event) => setSelected((previous) => ({ ...previous, [question.id]: question.multiSelect ? event.target.checked ? [...(previous[question.id] ?? []), option] : (previous[question.id] ?? []).filter((entry) => entry !== option) : [option] }))}/>{option}</label>)}<input aria-label={t("answer")} placeholder={t("answer")} value={free[question.id] ?? ""} onChange={(event) => setFree((previous) => ({ ...previous, [question.id]: event.target.value }))}/></fieldset>)}<div className="button-row"><button type="button" disabled={busy} onClick={() => void controller.answer(request.id, request.questions.map(() => null))}>{t("dismiss")}</button><button className="primary" disabled={busy}>{t("submitAnswer")}</button></div></form>;
}
