import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { SessionStatusKind } from "../state/labels";

/** A titled group of rows on a tonal card. */
export function Section({ title, action, footer, children }: { title?: string; action?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return <section className="section">
    {(title || action) && <div className="section-header"><span>{title}</span>{action}</div>}
    <div className="group">{children}</div>
    {footer && <div className="section-footer">{footer}</div>}
  </section>;
}

/** One settings or navigation row; renders a button only when it acts. */
export function Row({ leading, title, subtitle, trailing, onClick, chevron, danger, disabled, className = "" }: {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; onClick?: () => void;
  chevron?: boolean; danger?: boolean; disabled?: boolean; className?: string;
}) {
  const content = <>
    {leading && <span className="row-leading">{leading}</span>}
    <span className="row-body"><span className="row-title">{title}</span>{subtitle && <span className="row-subtitle">{subtitle}</span>}</span>
    {(trailing || chevron) && <span className="row-trailing">{trailing}{chevron && <ChevronRight size={18} className="row-chevron"/>}</span>}
  </>;
  const classes = `row ${danger ? "danger" : ""} ${className}`;
  return onClick
    ? <button type="button" className={classes} disabled={disabled} onClick={onClick}>{content}</button>
    : <div className={classes}>{content}</div>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange(checked: boolean): void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}/>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; icon?: ReactNode }>; onChange(value: T): void; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.icon}{option.label}</button>)}
  </div>;
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-illustration">{icon}</span><h2>{title}</h2>{children && <p>{children}</p>}{action}</div>;
}

export function StatusBadge({ status, label }: { status: SessionStatusKind | "online"; label?: string }) {
  return <span className={`status-badge ${status}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}/>;
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return <div aria-hidden="true">{Array.from({ length: count }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton"/><span className="skeleton-lines"><span className="skeleton"/><span className="skeleton"/></span></div>)}</div>;
}
