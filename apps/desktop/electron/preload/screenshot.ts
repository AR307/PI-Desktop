import { contextBridge, ipcRenderer } from "electron";
import { SCREENSHOT, type ScreenshotBridge } from "../screenshot-contract";

const bridge: ScreenshotBridge = {
  image: () => ipcRenderer.invoke(SCREENSHOT.image),
  ready: () => ipcRenderer.send(SCREENSHOT.ready),
  select: region => ipcRenderer.send(SCREENSHOT.select, region),
};
contextBridge.exposeInMainWorld("piScreenshot", bridge);
