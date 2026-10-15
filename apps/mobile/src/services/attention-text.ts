import type { TFunction } from "i18next";
import type { AttentionItem } from "../state/attention";

/** The title names what happened and where; the body carries the detail the desktop sent. */
export function attentionTitleKey(item: Pick<AttentionItem, "kind" | "requestKind" | "image">): string {
  if (item.kind === "approval") return item.requestKind === "plan" ? "attentionPlan" : item.requestKind === "goal" ? "attentionGoal" : "attentionApproval";
  if (item.kind === "input") return "attentionInput";
  if (item.kind === "completed") return item.image ? "attentionImageReady" : "attentionCompleted";
  return item.image ? "attentionImageFailed" : "attentionFailed";
}

export function formatAttention(item: AttentionItem, t: TFunction): { title: string; body: string } {
  const session = item.sessionTitle.trim() || t("mobile.untitledSession");
  const title = t(`mobile.${attentionTitleKey(item)}Title`, { session });
  const failure = item.errorCode ? t(`errors.${item.errorCode}`, { defaultValue: "" }) : "";
  const body = item.title ?? item.preview ?? (failure || t(`mobile.${attentionTitleKey(item)}Body`));
  return { title, body };
}
