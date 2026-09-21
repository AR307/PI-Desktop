export const MC_PRODUCTION_ORIGIN = "https://console.mirrorcoding.xyz";

/** Only development/test builds can change the account service origin. */
export function serviceOrigin(): string {
  const configured: string | undefined = import.meta.env.DEV || import.meta.env.MODE === "acceptance"
    ? import.meta.env.VITE_MC_ORIGIN : undefined;
  return configured ? new URL(configured).origin : MC_PRODUCTION_ORIGIN;
}
