import type { Mode } from "@pi-desktop/shared";
import { IconImage, IconListChecks, IconShield, IconTarget } from "../../../components/icons";

export function ModeIcon({ mode }: { mode: Mode | "image" }) {
  if (mode === "image") return <IconImage size={14} />;
  if (mode === "plan") return <IconListChecks size={14} />;
  if (mode === "goal") return <IconTarget size={14} />;
  return <IconShield size={14} />;
}
