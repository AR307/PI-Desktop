import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "xyz.mirrorcoding.pi.mobile",
  appName: "PI Mobile",
  webDir: "dist",
  android: { backgroundColor: "#181818" },
  plugins: { SystemBars: { insetsHandling: "css", initialViewportFitValueHint: "cover" } },
};

export default config;
