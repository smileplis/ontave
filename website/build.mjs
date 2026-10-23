import {
  readFile,
  writeFile,
  mkdir,
  rm,
  copyFile,
  readdir,
  cp,
} from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { marked } from "marked";
import { document, escape } from "./src/layout.mjs";
import { home } from "./src/home.mjs";
import { releaseVersion as version, referenceVersion, playgroundCommand, siteOrigin } from "./src/release.mjs";
import { entries, indexPage, entryPage } from "./src/content-index.mjs";
import { benchmarkData } from "./src/benchmarks.mjs";
import { playgroundMarkup } from "../examples/playground/markup.mjs";
const root = import.meta.dirname;
const dist = resolve(root, "dist");
await mkdir(resolve(root, ".cache"), { recursive: true });
await build({
  entryPoints: [resolve(root, "src/Story.tsx")],
  outfile: resolve(root, ".cache/story.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime"],
});
const { Story } = await import("./.cache/story.mjs?build=" + Date.now());
const storyMarkup = renderToString(React.createElement(Story));
const compiler = await compile(
  await readFile(resolve(root, "src/tailwind.css"), "utf8"),
  { base: resolve(root, "src"), onDependency: () => {} },
);
const scanner = new Scanner({ sources: compiler.sources });
const tailwindCSS = optimize(compiler.build(scanner.scan()), {
  minify: true,
}).code;
await writeFile(resolve(root, ".cache/tailwind.css"), tailwindCSS);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const navigation = JSON.parse(
  await readFile(resolve(root, "content/navigation.json"), "utf8"),
);
const pages = navigation.flatMap((g) =>
  g.pages.map((p) => ({
    ...p,
    group: g.title,
    path: p.slug === "introduction" ? "/docs/" : `/docs/${p.slug}/`,
  })),
);
const index = [];
const slugify = (v) =>
  v
    .replace(/<[^>]*>/g, "")
    .replace(/&[^;]*;/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
for (let position = 0; position < pages.length; position++) {
  const page = pages[position];
  const md = await readFile(resolve(root, `content/${page.slug}.md`), "utf8");
  let html = marked.parse(md, { gfm: true });
  const headings = [];
  const used = new Map();
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_, depth, label) => {
    const base = slugify(label);
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    const id = n ? `${base}-${n}` : base;
    headings.push({
      depth: Number(depth),
      label: label.replace(/<[^>]*>/g, ""),
      id,
    });
    return `<h${depth} id="${id}">${label}</h${depth}>`;
  });
  html = html
    .replace(
      /<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
      (_, language = "", text) =>
        `<div class="code-window"><div class="code-toolbar"><span><i></i>${escape(language || "code")}</span><button class="copy-code" aria-label="Copy code">Copy <span aria-hidden="true">⧉</span></button></div><pre><code>${text}</code></pre></div>`,
    )
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
  const side = navigation
    .map(g => `<details class="docs-nav-group" ${g.title === page.group || g.title === "Start" ? "open" : ""}><summary>${escape(g.title)}</summary><div>${g.pages.map(p => `<a href="${p.slug === "introduction" ? "/docs/" : `/docs/${p.slug}/`}" ${p.slug === page.slug ? 'aria-current="page"' : ""}>${escape(p.title)}</a>`).join("")}</div></details>`)
    .join("");
  const previous = pages[position - 1], next = pages[position + 1];
  const docsHome = page.slug === "introduction";
  const intro = docsHome ? `<div class="docs-home-hero"><span class="section-kicker">THE ONTAVE DEVELOPER GUIDE</span><h1>From a first source<br>to a useful record.</h1><p class="docs-lede">Set up Ontave, connect your data, and build on a model you control.</p><div class="docs-home-actions"><a class="button primary" href="/docs/quickstart/">Start building <span aria-hidden="true">↗</span></a><a class="text-link" href="/docs/api/">Explore the API <span aria-hidden="true">↗</span></a></div><div class="docs-paths"><a href="/docs/quickstart/"><span>01 / GET STARTED</span><h2>Your first record <i aria-hidden="true">↗</i></h2><p>One source. A reviewed interpretation. A typed read.</p></a><a href="/docs/architecture/"><span>02 / UNDERSTAND</span><h2>The architecture <i aria-hidden="true">↗</i></h2><p>See how evidence, models, and contracts fit.</p></a><a href="/docs/node/"><span>03 / MAKE IT YOURS</span><h2>Your own stack <i aria-hidden="true">↗</i></h2><p>Connect your server, database, and model.</p></a></div></div>` : `<div class="docs-article-heading"><span class="section-kicker">${escape(page.group.toUpperCase())}</span><h1>${escape(page.title)}</h1><p class="docs-lede">${escape(page.description)}</p></div>`;
  const body = `<div class="docs-mobile-bar"><button class="docs-mobile-toggle" aria-expanded="false" aria-controls="docs-sidebar"><span aria-hidden="true">☷</span> Browse documentation <span aria-hidden="true">⌄</span></button><span>${escape(page.title)}</span></div><button class="docs-backdrop" hidden tabindex="-1" aria-label="Close documentation navigation"></button><div class="docs-layout"><aside class="docs-sidebar" id="docs-sidebar" aria-label="Documentation navigation"><a href="/docs/" class="docs-sidebar-title"><span class="docs-sidebar-mark" aria-hidden="true">↳</span> Developer guide</a><a href="/docs/status/" class="docs-version"><span class="live-dot" aria-hidden="true"></span> ${version} <span>Preview ↗</span></a><nav aria-label="Documentation pages">${side}</nav><a class="docs-sidebar-playground" href="/playground/"><span>Learn by doing.</span>Open the playground <span aria-hidden="true">↗</span></a></aside><main class="docs-main ${docsHome ? "docs-home" : ""}" id="main"><div class="docs-breadcrumb"><a href="/docs/">Docs</a><span>/</span>${escape(page.group)}<span>/</span><span>${escape(page.title)}</span></div>${intro}<article class="docs-prose">${html}</article><div class="docs-pagination">${previous ? `<a href="${previous.path}"><span>← PREVIOUS</span>${escape(previous.title)}</a>` : "<div></div>"}${next ? `<a href="${next.path}"><span>NEXT →</span>${escape(next.title)}</a>` : "<div></div>"}</div><div class="docs-meta">Ontave · Apache 2.0 · <a href="/docs/status/">Release status ↗</a></div></main><aside class="docs-toc" aria-label="On this page"><strong>On this page</strong><div class="docs-toc-links">${headings.map(h=>`<a class="${h.depth === 3 ? "toc-sub" : ""}" href="#${h.id}">${h.label}</a>`).join("")}</div><a class="edit-link" href="https://github.com/smileplis/ontave/blob/main/website/content/${page.slug}.md">Edit this page <span aria-hidden="true">↗</span></a><a class="docs-toc-help" href="https://github.com/smileplis/ontave/issues/new?template=developer-preview.yml">Something unclear?<br><span>Help improve the guide ↗</span></a></aside></div>`;
  const path = resolve(dist, "." + page.path);
  await mkdir(path, { recursive: true });
  await writeFile(
    resolve(path, "index.html"),
    document({
      title: `${page.title} · Ontave`,
      description: page.description,
      path: page.path,
      body,
      docs: true,
    }),
  );
  index.push({
    title: page.title,
    description: page.description,
    path: page.path,
    text: md.replace(/[#*`|>]/g, "").slice(0, 35000),
  });
}
const feedItems = [];
const contextParts = [];
await mkdir(resolve(dist, "examples/read-only-agent"), { recursive: true });
for (const file of ["agent.ts", "package.json", "package-lock.json", "README.md", "smoke.test.mjs", "tsconfig.json"]) {
  await copyFile(resolve(root, "examples/read-only-agent", file), resolve(dist, "examples/read-only-agent", file));
}
await mkdir(resolve(dist, "index"), { recursive: true });
await writeFile(resolve(dist, "index/index.html"), document({
  title: "The Ontave index · Evidence, agents and typed records",
  description: "Learn to build AI agents in TypeScript, compare agent frameworks, design memory and document pipelines, and validate operational records with evidence.",
  path: "/index/", body: indexPage,
}));
for (const entry of entries) {
  let md = await readFile(resolve(root, `content/index/${entry.slug}.md`), "utf8");
  if (md.includes("<!-- include:read-only-agent -->")) {
    const example = await readFile(resolve(root, "examples/read-only-agent/agent.ts"), "utf8");
    md = md.replace("<!-- include:read-only-agent -->", "```ts\n" + example + "```\n");
  }
  const headings = [];
  const used = new Map();
  const html = marked.parse(md, { gfm: true })
    .replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_, depth, label) => {
      const base = slugify(label), n = used.get(base) || 0;
      used.set(base, n + 1);
      const id = n ? `${base}-${n}` : base;
      headings.push({ id, label: label.replace(/<[^>]*>/g, "") });
      return `<h${depth} id="${id}">${label}</h${depth}>`;
    })
    .replace(/<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g, (_, language, text) => `<div class="code-window"><div class="code-toolbar"><span>${escape({ts:"TypeScript",typescript:"TypeScript",sh:"terminal",json:"JSON"}[language] || language || "example")}</span><button class="copy-code" aria-label="Copy code">Copy</button></div><pre><code>${text}</code></pre></div>`)
    .replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  const minutes = Math.max(1, Math.ceil(md.replace(/```[\s\S]*?```/g, "").split(/\s+/).length / 200));
  const path = resolve(dist, "." + entry.path);
  await mkdir(path, { recursive: true });
  await writeFile(resolve(path, "index.html"), document({
    title: `${entry.title} · Ontave`, description: entry.description,
    path: entry.path, body: entryPage(entry, html, headings, minutes),
    image: `/art/${entry.art}.webp`, article: { published: entry.date },
  }));
  const markdown = `# ${entry.title}\n\n${md}`.replace(/\]\(\/(?!\/)/g, `](${siteOrigin}/`);
  await writeFile(resolve(path, "index.md"), markdown);
  contextParts.push(markdown);
  const absoluteHtml = marked.parse(md, { gfm: true }).replace(/(href|src)="\/(?!\/)/g, `$1="${siteOrigin}/`);
  feedItems.push({ id: siteOrigin + entry.path, url: siteOrigin + entry.path,
    title: entry.title, summary: entry.description, content_html: absoluteHtml,
    date_published: entry.date + "T00:00:00+05:30", authors: [{ name: "Ontave contributors" }],
  });
}
await writeFile(resolve(dist, "feed.json"), JSON.stringify({
  version: "https://jsonfeed.org/version/1.1", title: "The Ontave index",
  home_page_url: siteOrigin + "/index/", feed_url: siteOrigin + "/feed.json",
  description: "Guides to building agents, choosing frameworks and governing operational records.",
  language: "en", items: feedItems,
}, null, 2) + "\n");
await writeFile(resolve(dist, "feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>The Ontave index</title><link>${siteOrigin}/index/</link>
<description>Practical notes on evidence, agents and typed operational records.</description><language>en</language>
<atom:link href="${siteOrigin}/feed.xml" rel="self" type="application/rss+xml"/>
${feedItems.map(item => `<item><title>${escape(item.title)}</title><link>${item.url}</link><guid isPermaLink="true">${item.id}</guid><pubDate>${new Date(item.date_published).toUTCString()}</pubDate><description>${escape(item.content_html)}</description></item>`).join("\n")}
</channel></rss>\n`);
await writeFile(resolve(dist, "llms.txt"), `# Ontave

> Open-source TypeScript framework for source-linked evidence, reviewed assertions, additive ontology evolution and typed accepted-data queries.

Current public npm release: ${version}. Developer preview. Node.js 24, ESM and PostgreSQL 18 on a trusted server. The host supplies authentication, authorization, worker supervision, model configuration and review policy.

Ingestion preserves evidence and a durable job. Interpretation produces proposals. Model activation and fact acceptance are separate explicit decisions. Accepted records can be queried through a pinned contract without an LLM call at read time. Acceptance does not establish independent verification of a reported event.

Ontave does not supply an agent orchestrator, hosted database, browser/edge runtime, MCP server, automatic app generation or autonomous fact acceptance. Independent labels, live identity/discovery qualification and other MVP quality gates remain open.

## Start here
- [Documentation](${siteOrigin}/docs/): Concepts and integration guides.
- [Install from npm](https://www.npmjs.com/package/ontave): npm install ontave.
- [Quickstart](${siteOrigin}/docs/quickstart/): Fictional local playground using the real SDK and PostgreSQL.
- [API reference](${siteOrigin}/docs/api/): Configuration, operations and constraints.
- [Release status](${siteOrigin}/docs/status/): Supported surface and open quality gates.

## Architecture and use cases
${entries.map(entry => `- [${entry.title}](${siteOrigin}${entry.path}index.md): ${entry.description}`).join("\n")}

## Other formats
- [Full index text](${siteOrigin}/llms-full.txt)
- [RSS feed](${siteOrigin}/feed.xml)
- [JSON feed](${siteOrigin}/feed.json)
- [Source and license](https://github.com/smileplis/ontave): Apache 2.0.
`);
await writeFile(resolve(dist, "llms-full.txt"), `# The Ontave index\n\nDeveloper preview ${version}. See ${siteOrigin}/docs/status/ for current limits.\n\n${contextParts.join("\n\n")}\n`);
await writeFile(
  resolve(dist, "index.html"),
  document({
    title: "Ontave · A data layer that adapts as your business changes.",
    description:
      "An open-source TypeScript data layer for source-linked records, reviewed schema changes and typed queries. Preserve evidence, validate proposals and query accepted data.",
    body: home(storyMarkup),
  }),
);
await writeFile(
  resolve(dist, "benchmarks.json"),
  JSON.stringify(benchmarkData, null, 2) + "\n",
);
await mkdir(resolve(dist, "playground"), { recursive: true });
await writeFile(
  resolve(dist, "playground/index.html"),
  document({
    title: "Playground · Ontave",
    description:
      "Explore a fictional message-to-record flow, then run the real SDK and PostgreSQL locally.",
    path: "/playground/",
    body: playgroundMarkup(referenceVersion, { installCommand: playgroundCommand }),
    playground: true,
  }),
);
for (const file of ["playground.js", "playground.css"])
  await copyFile(
    resolve(root, "../examples/playground/web", file),
    resolve(dist, file),
  );
await writeFile(
  resolve(dist, "404.html"),
  document({
    title: "Page not found · Ontave",
    description: "This page has moved or does not exist.",
    path: "/404",
    body: '<main id="main" class="not-found frame"><span class="eyebrow">A MISSING PAGE, EXPLICITLY.</span><h1>404</h1><p>There is no accepted value at this address.</p><a class="button primary" href="/docs/">Find your way in the docs ↗</a></main>',
  }),
);
await writeFile(
  resolve(dist, "style.css"),
  (await readFile(resolve(root, ".cache/tailwind.css"), "utf8")) +
    "\n" +
    (await readFile(resolve(root, "src/style.css"), "utf8")) +
    "\n" +
    (await readFile(resolve(root, "src/expressive.css"), "utf8")) + "\n" +
    (await readFile(resolve(root, "src/refined.css"), "utf8")),
);
await copyFile(resolve(root, "src/light.css"), resolve(dist, "light.css"));
await build({
  entryPoints: [resolve(root, "src/client.ts")],
  outfile: resolve(dist, "client.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  minify: true,
  target: ["es2022"],
  legalComments: "eof",
});
await writeFile(resolve(dist, "search-index.json"), JSON.stringify(index));
for (const file of await readdir(resolve(root, "public"))) {
  await cp(resolve(root, "public", file), resolve(dist, file), { recursive: true });
}
await writeFile(
  resolve(dist, "robots.txt"),
  "User-agent: *\nAllow: /\nSitemap: https://ontave.daltn.tech/sitemap.xml\n",
);
await writeFile(
  resolve(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/playground/", "/index/", ...entries.map((p) => p.path), ...pages.map((p) => p.path)].map((path) => `<url><loc>https://ontave.daltn.tech${path}</loc>${entries.some(entry => entry.path === path) ? `<lastmod>${entries.find(entry => entry.path === path).date}</lastmod>` : ""}</url>`).join("")}</urlset>`,
);
console.log(
  JSON.stringify({ pages: pages.length + entries.length + 4, output: "dist", status: "built" }),
);
