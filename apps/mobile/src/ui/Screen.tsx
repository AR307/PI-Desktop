import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A tab screen: a large title that hands over to a compact, translucent
 * header once it scrolls away, as on native platforms.
 */
export function Screen({ title, subtitle, leading, actions, children, className = "", label }: {
  title: string; subtitle?: ReactNode; leading?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; label?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const target = sentinel.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting), { root: scroller.current });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return <section className={`screen ${className}`} aria-label={label ?? title}>
    <header className={`screen-header ${scrolled ? "scrolled" : ""}`}>
      <div className="screen-header-leading">{leading}</div>
      <div className="screen-header-title" aria-hidden="true">{title}</div>
      <div className="screen-header-actions">{actions}</div>
    </header>
    <div className="screen-scroll" ref={scroller}>
      <div className="large-title"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div></div>
      <div className="title-sentinel" ref={sentinel}/>
      {children}
    </div>
  </section>;
}
