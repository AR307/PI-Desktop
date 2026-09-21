import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Platform-independent prose: raw HTML is disabled and external links are explicit. */
export function Markdown({ children }: { children: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children: label }) => <a href={href} target="_blank" rel="noreferrer">{label}</a>,
    img: ({ alt }) => <span className="muted">{alt}</span>,
  }}>{children}</ReactMarkdown></div>;
}
