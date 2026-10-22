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
import { benchmarkData } from "./src/benchmarks.mjs";
import { playgroundMarkup } from "../examples/playground/markup.mjs";
const root = import.meta.dirname;
const version = JSON.parse(
  await readFile(resolve(root, "../package.json"), "utf8"),
).version;
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
await writeFile(
  resolve(dist, "index.html"),
  document({
    title: "Ontave · A data layer that adapts as your business changes.",
    description:
      "Turn unexpected messages into useful records. An open-source TypeScript framework for preserved evidence, reviewed model changes, and typed application contracts.",
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
    body: playgroundMarkup(version),
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
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/playground/", ...pages.map((p) => p.path)].map((path) => `<url><loc>https://ontave.daltn.tech${path}</loc></url>`).join("")}</urlset>`,
);
console.log(
  JSON.stringify({ pages: pages.length + 3, output: "dist", status: "built" }),
);
