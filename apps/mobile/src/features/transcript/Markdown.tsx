import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Platform-independent prose: raw HTML is disabled and external links are
 * explicit. Memoized on the source text — remark parsing is the most expensive
 * part of a transcript frame, so unchanged messages must not re-parse while a
 * neighbor streams.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children: label }) => <a href={href} target="_blank" rel="noreferrer">{label}</a>,
    img: ({ alt }) => <span className="muted">{alt}</span>,
  }}>{children}</ReactMarkdown></div>;
});
