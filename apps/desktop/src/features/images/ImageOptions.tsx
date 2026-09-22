import { useTranslation } from "react-i18next";
import type { ImageGenerationCapability, ImageGenerationOptions } from "@pi-desktop/shared";

export function ImageOptions({ capability, options, references, disabled, onChange }: {
  capability?: ImageGenerationCapability;
  options: ImageGenerationOptions;
  references: number;
  disabled: boolean;
  onChange: (options: ImageGenerationOptions) => void;
}) {
  const { t } = useTranslation();
  if (!capability) return <p className="image-options-notice" role="status">{t("images.empty")}</p>;
  return <div className="image-options">
    {capability.max_count > 1 ? <label>{t("images.count")}
      <input type="number" min={1} max={capability.max_count} value={options.count ?? 1} disabled={disabled}
        aria-label={t("images.count")} onChange={(event) => {
          const count = Number(event.target.value);
          if (Number.isInteger(count) && count >= 1 && count <= capability.max_count) onChange({ count });
        }} />
    </label> : null}
    <span role={references && !capability.reference_path ? "alert" : "status"} className="image-options-notice">
      {t(capability.reference_path ? "images.referencesSupported" : "images.images_reference_unsupported")}
    </span>
  </div>;
}
