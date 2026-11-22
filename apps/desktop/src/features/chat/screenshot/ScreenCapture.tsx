import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createRoot } from "react-dom/client";
import type { ScreenshotBridge } from "../../../../electron/screenshot-contract";
import { Button } from "../../../components/ui";
import "../../../styles/tokens.css";
import "../../../styles/ui-kit.css";
import "./screenshot.css";

declare global { interface Window { piScreenshot: ScreenshotBridge } }
type Point = { x: number; y: number };

function ScreenCapture() {
  const [image, setImage] = useState("");
  const [end, setEnd] = useState<Point | null>(null);
  const start = useRef<Point | null>(null);
  const [error, setError] = useState("");
  const cancel = () => window.piScreenshot.select(null);
  useEffect(() => {
    void window.piScreenshot.image().then(setImage).catch(error => {
      setError(String(error));
      window.piScreenshot.ready();
    });
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") window.piScreenshot.select(null); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const point = (event: PointerEvent): Point => ({
    x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
    y: Math.max(0, Math.min(window.innerHeight, event.clientY)),
  });
  const origin = start.current;
  const rect = origin && end ? {
    left: Math.min(origin.x, end.x), top: Math.min(origin.y, end.y),
    width: Math.abs(origin.x - end.x), height: Math.abs(origin.y - end.y),
  } : null;
  return (
    <div className="screenshot-surface"
      onContextMenu={event => { event.preventDefault(); cancel(); }}
      onPointerDown={event => {
        if (event.button !== 0 || !image) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = point(event);
        setEnd(start.current);
      }}
      onPointerMove={event => { if (start.current) setEnd(point(event)); }}
      onPointerCancel={() => { start.current = null; setEnd(null); }}
      onPointerUp={event => {
        const origin = start.current;
        if (event.button !== 0 || !origin) return;
        const end = point(event);
        start.current = null;
        setEnd(null);
        if (origin.x === end.x || origin.y === end.y) return;
        window.piScreenshot.select({
          left: Math.min(origin.x, end.x) / window.innerWidth,
          top: Math.min(origin.y, end.y) / window.innerHeight,
          right: Math.max(origin.x, end.x) / window.innerWidth,
          bottom: Math.max(origin.y, end.y) / window.innerHeight,
        });
      }}>
      {image ? <img src={image} alt="" draggable={false} onLoad={() => window.piScreenshot.ready()} /> : null}
      <div className="screenshot-mask" />
      {rect ? <div className="screenshot-region" style={rect} /> : null}
      <Button variant="secondary" size="sm" className="screenshot-cancel" onPointerDown={event => event.stopPropagation()} onClick={cancel}>Esc</Button>
      {error ? <pre role="alert">{error}</pre> : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<ScreenCapture />);
