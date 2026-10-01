import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Mode } from "@pi-desktop/shared";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { TooltipButton } from "../../../components/ui";
import { IconCheck, IconChevronDown } from "../../../components/icons";
import { ModeIcon } from "./ComposerModeIcon";
import { MODE_LABEL_KEYS } from "./model";

export type ComposerMode = Mode | "image";
const modes: readonly ComposerMode[] = ["agent", "plan", "goal", "image"];

/** One selection path for both cycling and the accessible dropdown. */
export function ComposerModePicker({ mode, planningLive = false, blocked, onSelect, onOpen }: {
  mode: ComposerMode;
  planningLive?: boolean;
  blocked: boolean;
  onSelect: (mode: ComposerMode) => Promise<void>;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (blocked) setOpen(false); }, [blocked]);
  const label = (value: ComposerMode) => t(value === "image" ? "images.mode" : MODE_LABEL_KEYS[value]);
  const chipLabel = planningLive && mode !== "image" ? t(`${mode}.planning`) : label(mode);
  const select = (value: ComposerMode) => {
    setOpen(false);
    onOpen();
    void onSelect(value);
  };
  return <div className="composer-mode-switch">
    <TooltipButton type="button" className="icon-btn mode-chip composer-mode-chip"
      data-mode={mode} data-planning={planningLive ? "true" : undefined}
      tooltip={chipLabel} ariaLabel={chipLabel} disabled={blocked}
      onClick={() => select(modes[(modes.indexOf(mode) + 1) % modes.length])}>
      <span className="composer-mode-chip-face" key={mode}>
        <ModeIcon mode={mode} /><span className="composer-mode-chip-label text-sm">{label(mode)}</span>
      </span>
    </TooltipButton>
    <AnchoredMenu className="composer-mode-menu" open={open} onClose={() => setOpen(false)}
      menuClassName="composer-permission-menu" label={t("images.chooseMode")} role="menu" align="start" side="top"
      onMenuKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
      trigger={(ref) => <TooltipButton ref={ref} type="button" className="icon-btn mode-chip composer-mode-chevron"
        tooltip={t("images.chooseMode")} ariaLabel={t("images.chooseMode")} disabled={blocked}
        aria-haspopup="menu" aria-expanded={open} onClick={() => { onOpen(); setOpen(!open); }}>
        <IconChevronDown size={12} aria-hidden="true" />
      </TooltipButton>}>
      {modes.map((candidate) => <button key={candidate} type="button" role="menuitemradio"
        aria-checked={candidate === mode} className={`composer-plus-item ${candidate === mode ? "active" : ""}`}
        onClick={() => select(candidate)}>
        <ModeIcon mode={candidate} /><span className="flex-1 text-left">{label(candidate)}</span>
        {candidate === mode ? <IconCheck size={13} /> : null}
      </button>)}
    </AnchoredMenu>
  </div>;
}
