import { BrowserWindow, desktopCapturer, ipcMain, screen, type NativeImage } from "electron";
import { join } from "node:path";
import type { ComposerPasteFile } from "@pi-desktop/shared";
import { SCREENSHOT, screenshotPixelRect } from "../screenshot-contract";
import { getModuleDirectory } from "./module-path";

let capturing = false;

/** An explicit user capture. Images stay in memory until the normal attachment import. */
export async function captureComposerScreenshot(owner: BrowserWindow): Promise<ComposerPasteFile | null> {
  if (capturing) return null;
  capturing = true;
  const ownerContents = owner.webContents;
  const overlays = new Map<number, { window: BrowserWindow; image: NativeImage; displayId: number }>();
  let complete!: (outcome: { file: ComposerPasteFile | null } | { error: Error }) => void;
  let ended = false;
  const result = new Promise<{ file: ComposerPasteFile | null } | { error: Error }>(resolve => { complete = resolve; });
  const cancel = () => { ended = true; complete({ file: null }); };
  const overlayFor = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    const overlay = overlays.get(event.sender.id);
    if (!overlay || event.senderFrame !== event.sender.mainFrame) throw new Error("Invalid screenshot sender");
    return overlay;
  };
  const activeDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  const ready = (event: Electron.IpcMainEvent) => {
    const overlay = overlays.get(event.sender.id);
    if (!overlay || event.senderFrame !== event.sender.mainFrame) return;
    if (overlay.displayId === activeDisplay) overlay.window.show();
    else overlay.window.showInactive();
  };
  const select = (event: Electron.IpcMainEvent, region: unknown) => {
    if (!overlays.has(event.sender.id) || event.senderFrame !== event.sender.mainFrame) return;
    try {
      const overlay = overlayFor(event);
      if (region === null) return cancel();
      const rect = screenshotPixelRect(region, overlay.image.getSize());
      if (!rect) return;
      ended = true;
      complete({ file: {
        name: `screenshot-${Date.now()}.png`, mimeType: "image/png",
        data: Uint8Array.from(overlay.image.crop(rect).toPNG()).buffer,
      } });
    } catch (error) {
      ended = true;
      complete({ error: error instanceof Error ? error : new Error(String(error)) });
    }
  };
  owner.once("closed", cancel);
  ownerContents.once("did-start-navigation", cancel);
  screen.once("display-removed", cancel);
  try {
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({
      types: ["screen"], fetchWindowIcons: false,
      thumbnailSize: {
        width: Math.max(...displays.map(display => Math.ceil(display.size.width * display.scaleFactor))),
        height: Math.max(...displays.map(display => Math.ceil(display.size.height * display.scaleFactor))),
      },
    });
    if (ended || owner.isDestroyed()) return null;
    ipcMain.handle(SCREENSHOT.image, event => overlayFor(event).image.toDataURL());
    ipcMain.on(SCREENSHOT.ready, ready);
    ipcMain.on(SCREENSHOT.select, select);
    for (const display of displays) {
      if (ended) break;
      const image = sources.find(source => source.display_id === String(display.id))?.thumbnail;
      if (!image || image.isEmpty()) throw new Error("Screen capture is unavailable. Check operating-system screen recording permission.");
      const overlay = new BrowserWindow({
        ...display.bounds, show: false, frame: false, title: "PI-Desktop Screenshot",
        backgroundColor: "#000000", hasShadow: false, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, alwaysOnTop: true, autoHideMenuBar: true,
        enableLargerThanScreen: true,
        webPreferences: {
          preload: join(getModuleDirectory(import.meta.url), "../preload/screenshot.cjs"),
          contextIsolation: true, sandbox: true, nodeIntegration: false,
        },
      });
      overlays.set(overlay.webContents.id, { window: overlay, image, displayId: display.id });
      overlay.setBounds(display.bounds);
      overlay.setAlwaysOnTop(true, "screen-saver");
      if (process.platform === "darwin") overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      overlay.webContents.on("will-navigate", event => event.preventDefault());
      overlay.webContents.once("render-process-gone", () => {
        ended = true;
        complete({ error: new Error("Screenshot window closed unexpectedly") });
      });
      overlay.once("closed", cancel);
      if (process.env.ELECTRON_RENDERER_URL) {
        await overlay.loadURL(new URL("screenshot.html", process.env.ELECTRON_RENDERER_URL).href);
      } else {
        await overlay.loadFile(join(getModuleDirectory(import.meta.url), "../renderer/screenshot.html"));
      }
    }
    const outcome = await result;
    if ("error" in outcome) throw outcome.error;
    return outcome.file;
  } finally {
    ipcMain.removeHandler(SCREENSHOT.image);
    ipcMain.removeListener(SCREENSHOT.ready, ready);
    ipcMain.removeListener(SCREENSHOT.select, select);
    owner.removeListener("closed", cancel);
    ownerContents.removeListener("did-start-navigation", cancel);
    screen.removeListener("display-removed", cancel);
    for (const { window } of overlays.values()) if (!window.isDestroyed()) window.destroy();
    if (!owner.isDestroyed()) owner.focus();
    capturing = false;
  }
}
