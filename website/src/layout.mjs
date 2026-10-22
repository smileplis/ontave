export const escape = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const arrow = '<span aria-hidden="true">↗</span>';
export const brand =
  '<a class="brand" href="/" aria-label="Ontave home"><img src="/ontave-wordmark.svg" alt="Ontave" width="132" height="32"></a>';
export function header(docs = false) {
  return `<header class="site-header"><div class="header-inner">${brand}<nav aria-label="Main navigation"><a href="/#approach">Approach</a><a href="/playground/">Playground</a><a href="/#benchmarks">Benchmarks</a><a ${docs ? 'aria-current="page"' : ""} href="/docs/">Documentation</a></nav><div class="header-actions"><button class="search-trigger" aria-label="Search documentation"><span>Search docs</span><kbd>⌘ K</kbd></button><a class="github-link" href="https://github.com/smileplis/ontave" aria-label="Ontave on GitHub"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.22.68-.48v-1.69c-2.78.6-3.37-1.18-3.37-1.18-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03A9.58 9.58 0 0 1 12 7c.85 0 1.71.11 2.51.33 1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.58c0 .27.18.59.69.48A10 10 0 0 0 12 2Z"/></svg></a><button class="menu-toggle" aria-label="Open navigation" aria-expanded="false">☰</button></div></div><div class="mobile-nav" hidden><a href="/#approach">Approach</a><a href="/playground/">Playground</a><a href="/#benchmarks">Benchmarks</a><a href="/docs/">Documentation</a><a href="https://github.com/smileplis/ontave">GitHub ↗</a></div></header>`;
}
export const footer = `<footer class="footer"><div class="footer-top">${brand}<p>A little room for<br>what comes next.</p><div><a href="/docs/">Documentation</a><a href="/docs/benchmarks/">Benchmarks</a><a href="https://github.com/smileplis/ontave">GitHub ↗</a></div><div><a href="/docs/status/">Release status</a><a href="/docs/contributing/">Contributing</a><a href="/docs/license/">Apache 2.0</a></div></div><div class="footer-bottom"><span>© 2026 Ontave contributors</span><span>Built for the unexpected.</span><span class="status-dot">0.1.0-alpha.2 · Developer preview</span></div></footer>`;
export const search = `<dialog id="search-dialog" aria-label="Search documentation"><form method="dialog" class="search-top"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="6" stroke="currentColor"/><path d="m15 15 5 5" stroke="currentColor"/></svg><input id="docs-search" type="search" placeholder="Search the documentation…" autocomplete="off" aria-label="Search terms"><button aria-label="Close search">Esc</button></form><div id="search-results" aria-live="polite"></div><div class="search-bottom">Search concepts, guides and API methods.</div></dialog><div id="toast" role="status" aria-live="polite"></div>`;
export function document({
  title,
  description,
  path = "/",
  body,
  docs = false,
  playground = false,
}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#0b0a0c"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="https://app.daltn.tech${path}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:type" content="website"><meta property="og:image" content="https://app.daltn.tech/social.svg"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/style.css"><script type="module" src="/client.js"></script>${playground ? '<link rel="stylesheet" href="/playground.css"><script type="module" src="/playground.js"></script>' : ""}</head><body class="${docs ? "docs-body" : ""}"><a class="skip-link" href="#main">Skip to content</a>${header(docs)}${body}${search}${docs ? "" : footer}</body></html>`;
}
export function code(text, filename = "example.ts") {
  return `<div class="code-window"><div class="code-toolbar"><span><i></i>${escape(filename)}</span><button class="copy-code" aria-label="Copy code">Copy <span aria-hidden="true">⧉</span></button></div><pre><code>${escape(text)}</code></pre></div>`;
}
