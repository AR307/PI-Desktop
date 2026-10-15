import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Hand } from "lucide-react";
import type { PlanProposal, RacpApprovalRequest, RacpInputRequest } from "@pi-desktop/shared";
import type { MobileController } from "../../state/controller";
import { Markdown } from "../transcript/Markdown";
import { withoutLeadingTitle } from "../../state/labels";

export function Approval({ request, controller, markdown }: { request: RacpApprovalRequest; controller: MobileController; markdown?: string }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [busy, setBusy] = useState(false);
  return <section className="action-card">
    <h3>{request.title ?? t("permission")}</h3>
    <Markdown>{markdown ? withoutLeadingTitle(markdown, request.title) : request.summary}</Markdown>
    {request.question && <p>{request.question}</p>}
    <div className="button-row">{request.allowedDecisions.filter((decision) => decision !== "allow-session").map((decision) =>
      <button type="button" disabled={busy} className={decision === "allow-once" || decision === "approve" ? "button-primary" : ""} key={decision}
        onClick={async () => { setBusy(true); await controller.approve(request.id, decision); setBusy(false); }}>
        {t(decision === "approve" ? "approvePlan" : decision === "reject" ? "rejectPlan" : decision === "deny" ? "reject" : "approve")}
      </button>)}</div>
  </section>;
}

export function Question({ request, controller }: { request: RacpInputRequest; controller: MobileController }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [free, setFree] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    await controller.answer(request.id, request.questions.map((question) => {
      const answers = [...(selected[question.id] ?? []), ...(free[question.id]?.trim() ? [free[question.id]!.trim()] : [])];
      return answers.length ? answers : null;
    }));
    setBusy(false);
  };
  const choose = (questionId: string, option: string, multiple: boolean, checked: boolean) => setSelected((previous) => ({
    ...previous,
    [questionId]: multiple ? checked ? [...(previous[questionId] ?? []), option] : (previous[questionId] ?? []).filter((entry) => entry !== option) : [option],
  }));
  return <form className="action-card" onSubmit={(event) => void submit(event)}>
    <h3>{t("question")}</h3>
    {request.questions.map((question) => <fieldset key={question.id}>
      <legend>{question.question}</legend>
      {question.options.map((option) => <label className="option" key={option}>
        <input type={question.multiSelect ? "checkbox" : "radio"} name={question.id} checked={(selected[question.id] ?? []).includes(option)} onChange={(event) => choose(question.id, option, question.multiSelect, event.target.checked)}/>{option}
      </label>)}
      <input aria-label={t("answer")} placeholder={t("answer")} value={free[question.id] ?? ""} onChange={(event) => setFree((previous) => ({ ...previous, [question.id]: event.target.value }))}/>
    </fieldset>)}
    <div className="button-row">
      <button type="button" disabled={busy} onClick={() => void controller.answer(request.id, request.questions.map(() => null))}>{t("dismiss")}</button>
      <button type="submit" className="button-primary" disabled={busy}>{t("submitAnswer")}</button>
    </div>
  </form>;
}

/** Approvals and questions stay above the composer until they are answered. */
export function PendingDock({ controller, approvals, inputs, plans }: { controller: MobileController; approvals: RacpApprovalRequest[]; inputs: RacpInputRequest[]; plans?: PlanProposal[] }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [open, setOpen] = useState(true);
  const count = approvals.length + inputs.length;
  if (!count) return null;
  return <section className="pending-dock" aria-label={t("waitingForYou")}>
    <button type="button" className="pending-dock-header" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Hand size={16}/>{t("waitingForYou")}<span className="pending-count">{count}</span>
      <ChevronDown size={16} className={open ? undefined : "rotate-180"}/>
    </button>
    {open && <div className="pending-dock-body">
      {approvals.map((request) => <Approval key={request.id} request={request} controller={controller} markdown={plans?.find((plan) => plan.id === request.id)?.markdown}/>)}
      {inputs.map((request) => <Question key={request.id} request={request} controller={controller}/>)}
    </div>}
  </section>;
}
