import {
  readFile,
  writeFile,
  mkdir,
  rm,
  copyFile,
  readdir,
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
    .map(
      (g) =>
        `<div class="docs-nav-group"><h2>${escape(g.title)}</h2>${g.pages.map((p) => `<a href="${p.slug === "introduction" ? "/docs/" : `/docs/${p.slug}/`}" ${p.slug === page.slug ? 'aria-current="page"' : ""}>${escape(p.title)}</a>`).join("")}</div>`,
    )
    .join("");
  const previous = pages[position - 1],
    next = pages[position + 1];
  const body = `<button class="docs-mobile-toggle" aria-expanded="false" aria-controls="docs-sidebar">Browse documentation <span>☰</span></button><div class="docs-layout"><aside class="docs-sidebar" id="docs-sidebar" aria-label="Documentation navigation"><a href="/docs/status/" class="docs-version">Ontave Zero <span>${version} · Preview ↓</span></a>${side}</aside><main class="docs-main" id="main"><div class="docs-breadcrumb">Documentation <span>/</span> ${escape(page.group)}</div><h1>${escape(page.title)}</h1><p class="docs-lede">${escape(page.description)}</p><article class="docs-prose">${html}</article><div class="docs-pagination">${previous ? `<a href="${previous.path}"><span>← PREVIOUS</span>${escape(previous.title)}</a>` : "<div></div>"}${next ? `<a href="${next.path}"><span>NEXT →</span>${escape(next.title)}</a>` : "<div></div>"}</div><div class="docs-meta">Ontave Zero · Apache 2.0 · <a href="/docs/status/">Alpha release status</a></div></main><aside class="docs-toc" aria-label="On this page"><strong>On this page</strong>${headings.map((h) => `<a class="${h.depth === 3 ? "toc-sub" : ""}" href="#${h.id}">${h.label}</a>`).join("")}<a class="edit-link" href="https://github.com/smileplis/ontave/blob/main/website/content/${page.slug}.md">Edit this page ↗</a></aside></div>`;
  const path = resolve(dist, "." + page.path);
  await mkdir(path, { recursive: true });
  await writeFile(
    resolve(path, "index.html"),
    document({
      title: `${page.title} — Ontave`,
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
    title: "Ontave — Your schema didn’t see this coming.",
    description:
      "Evidence-backed information, reviewed model changes and typed application contracts. An open-source TypeScript framework for what comes next.",
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
    title: "Playground — Ontave",
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
    title: "Page not found — Ontave",
    description: "This page has moved or does not exist.",
    path: "/404",
    body: '<main id="main" class="not-found frame"><span class="eyebrow">A MISSING PAGE, EXPLICITLY.</span><h1>404</h1><p>There is no accepted value at this address.</p><a class="button primary" href="/docs/">Find your way in the docs ↗</a></main>',
  }),
);
await writeFile(
  resolve(dist, "style.css"),
  (await readFile(resolve(root, ".cache/tailwind.css"), "utf8")) +
    "\n" +
    (await readFile(resolve(root, "src/style.css"), "utf8")),
);
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
  await copyFile(resolve(root, "public", file), resolve(dist, file));
}
await writeFile(
  resolve(dist, "robots.txt"),
  "User-agent: *\nAllow: /\nSitemap: https://app.daltn.tech/sitemap.xml\n",
);
await writeFile(
  resolve(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/playground/", ...pages.map((p) => p.path)].map((path) => `<url><loc>https://app.daltn.tech${path}</loc></url>`).join("")}</urlset>`,
);
console.log(
  JSON.stringify({ pages: pages.length + 3, output: "dist", status: "built" }),
);
