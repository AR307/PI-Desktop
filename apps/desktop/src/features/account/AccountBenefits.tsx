import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MirrorCodingBenefitsState } from "@pi-desktop/shared";
import { Button, TooltipButton } from "../../components/ui";
import { AnchoredMenu } from "../../components/settings/AnchoredMenu";
import { subscriptionQuota } from "./benefits-model";
import { useAccountBenefits } from "./useAccountBenefits";
import "./benefits.css";

export function AccountBenefitsPanel({
  state,
  refresh,
}: {
  state: MirrorCodingBenefitsState;
  refresh(checkIn?: boolean): Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const data = state.data;
  const quota = data ? subscriptionQuota(data) : undefined;
  const amount = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(
      value / (data?.quotaPerUnit ?? 1),
    );
  const date = (value: string) => new Date(value).toLocaleString(i18n.language);
  const busy = state.status === "loading";
  return (
    <section className="mc-benefits-panel" aria-busy={busy}>
      <div className="mc-benefits-heading">
        <h3>{t("accountBenefits.title")}</h3>
        <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>
          {t("accountBenefits.refresh")}
        </Button>
      </div>
      {busy && !data ? <p role="status">{t("common.loading")}</p> : null}
      {state.error ? (
        <p className="mc-benefits-error" role="alert">
          {t(`accountBenefits.${state.error}`)}
        </p>
      ) : null}
      {data ? (
        <>
          <div className="mc-checkin">
            <div>
              <strong>{t("accountBenefits.checkIn")}</strong>
              <p>
                {data.checkIn.date} · {data.checkIn.timeZone}
              </p>
              {data.checkIn.checkedIn && data.checkIn.reward !== null ? (
                <p role="status">
                  {t("accountBenefits.reward", {
                    amount: amount(data.checkIn.reward),
                    unit: data.quotaUnit,
                  })}
                </p>
              ) : null}
              {!data.checkIn.enabled ? (
                <p>{t("accountBenefits.checkInDisabled")}</p>
              ) : !data.checkInAllowed ? (
                <p>{t("accountBenefits.permission_required")}</p>
              ) : null}
            </div>
            <Button
              disabled={
                busy || data.checkIn.checkedIn || !data.checkIn.enabled || !data.checkInAllowed
              }
              onClick={() => void refresh(true)}
            >
              {t(
                data.checkIn.checkedIn
                  ? "accountBenefits.checkedIn"
                  : "accountBenefits.checkInAction",
              )}
            </Button>
          </div>
          {!data.subscriptionsRead ? (
            <p>{t("accountBenefits.permission_required")}</p>
          ) : (
            <>
              <p className="mc-benefits-note">{t("accountBenefits.scope")}</p>
              {!quota?.subscriptions.length ? <p>{t("accountBenefits.noSubscriptions")}</p> : null}
              <div className="mc-subscriptions">
                {quota?.subscriptions.map((item) => (
                  <article className="mc-subscription" key={item.id}>
                    <strong>{item.name}</strong>
                    <p>
                      {item.quotaTotal === null
                        ? t("accountBenefits.unlimited")
                        : t("accountBenefits.quota", {
                            remaining: amount(Math.max(0, item.quotaTotal - item.quotaUsed)),
                            total: amount(item.quotaTotal),
                            unit: data.quotaUnit,
                          })}
                    </p>
                    <p>
                      {t("accountBenefits.used", {
                        used: amount(item.quotaUsed),
                        unit: data.quotaUnit,
                      })}
                    </p>
                    <p>{t("accountBenefits.expires", { date: date(item.expiresAt) })}</p>
                    {item.nextResetAt ? (
                      <p>{t("accountBenefits.resets", { date: date(item.nextResetAt) })}</p>
                    ) : null}
                    <p>
                      {t("accountBenefits.groups", {
                        groups: item.groups.length
                          ? item.groups.join(", ")
                          : t("accountBenefits.allGroups"),
                      })}
                    </p>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      ) : null}
      {state.updatedAt ? (
        <small>
          {t("accountBenefits.updated", {
            date: new Date(state.updatedAt).toLocaleTimeString(i18n.language),
          })}
        </small>
      ) : null}
    </section>
  );
}

/** Compact account-wide indicator before the composer model picker. */
export function AccountBenefitsControl({ onOpen }: { onOpen(): void }) {
  const { t, i18n } = useTranslation();
  const { connected, state, refresh } = useAccountBenefits();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!connected) setOpen(false);
  }, [connected]);
  if (!connected) return null;
  const quota = state.data?.subscriptionsRead ? subscriptionQuota(state.data) : undefined;
  const known = state.status !== "error" && quota && quota.subscriptions.length > 0;
  const tooltip = !known
    ? t(
        state.error
          ? `accountBenefits.${state.error}`
          : state.data?.subscriptionsRead
            ? "accountBenefits.noSubscriptions"
            : "accountBenefits.unknown",
      )
    : quota.unlimited
      ? t("accountBenefits.unlimited")
      : t("accountBenefits.remaining", {
          percent: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
            quota.percent ?? 0,
          ),
        });
  return (
    <AnchoredMenu
      open={open}
      onClose={() => setOpen(false)}
      role="dialog"
      label={t("accountBenefits.title")}
      className="mc-benefits-control"
      menuClassName="mc-benefits-popover"
      side="top"
      align="end"
      trigger={(ref) => (
        <TooltipButton
          ref={ref}
          className="icon-btn mc-quota-trigger"
          tooltip={tooltip}
          ariaLabel={`${t("accountBenefits.title")}: ${tooltip}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            if (!open) {
              onOpen();
              void refresh();
            }
            setOpen((value) => !value);
          }}
        >
          <span
            className={`mc-quota-track is-${known ? quota.tone : "unknown"}`}
            aria-hidden="true"
            data-testid="subscription-quota-bar"
          >
            <span style={{ width: `${known ? (quota.unlimited ? 100 : quota.percent) : 0}%` }} />
          </span>
        </TooltipButton>
      )}
    >
      <AccountBenefitsPanel state={state} refresh={refresh} />
    </AnchoredMenu>
  );
}

export function AccountBenefitsSettings() {
  const { connected, state, refresh } = useAccountBenefits();
  return connected ? (
    <div className="settings-card-block mirrorcoding-card">
      <AccountBenefitsPanel state={state} refresh={refresh} />
    </div>
  ) : null;
}
