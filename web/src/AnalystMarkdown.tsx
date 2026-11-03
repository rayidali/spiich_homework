import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Provider prose is text/Markdown, never executable HTML or remote image content. */
export function AnalystMarkdown({ text }: { text: string }) {
  return (
    <div className="analyst-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            if (!href || !/^(https?:\/\/|\/(?!\/)|#)/i.test(href)) return <span>{children}</span>;
            const external = /^https?:\/\//i.test(href);
            return (
              <a
                href={href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
              >
                {children}
              </a>
            );
          },
          img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
          table: ({ children }) => (
            <div className="analyst-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
