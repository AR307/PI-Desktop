import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "xyz.mirrorcoding.pi.mobile",
  appName: "PI Mobile",
  webDir: "dist",
  android: { backgroundColor: "#181818" },
  plugins: { Keyboard: { resizeOnFullScreen: true } },
};

export default config;
