import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "dist");
async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    files.push(...(item.isDirectory() ? await walk(path) : [path]));
  }
  return files;
}
let links = 0;
const files = await walk(root);
for (const file of files) {
  if (!file.endsWith(".html")) continue;
  const html = await readFile(file, "utf8");
  assert.ok(html.includes('lang="en"'));
  assert.equal((html.match(/<h1(?: |>)/g) || []).length, 1, file);
  assert.ok(
    !/AIza[A-Za-z0-9_-]{30,}|gsk_[A-Za-z0-9]{35,}|\/Users\//.test(html),
    "Private content found",
  );
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = match[1];
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const url = new URL(href, "http://local");
    let path = resolve(root, "." + decodeURIComponent(url.pathname));
    try {
      if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
      await stat(path);
    } catch {
      throw Error(`Broken link: ${href} in ${file}`);
    }
    if (url.hash && path.endsWith(".html"))
      assert.ok(
        (await readFile(path, "utf8")).includes(
          `id="${decodeURIComponent(url.hash.slice(1))}"`,
        ),
        `Missing anchor ${href}`,
      );
    links++;
  }
}
const search = JSON.parse(
  await readFile(resolve(root, "search-index.json"), "utf8"),
);
assert.equal(search.length, 29);
assert.ok(search.some((x) => x.title === "Your first accepted record"));
const home = await readFile(resolve(root, "index.html"), "utf8");
assert.ok(!home.includes('class="eyebrow"'));
assert.ok(home.includes('data-slot="button"'));
assert.ok(home.includes("The evaluation"));
assert.ok(!files.some((f) => f.includes("/research/")));
console.log(
  JSON.stringify({
    ok: true,
    htmlPages: files.filter((f) => f.endsWith(".html")).length,
    internalLinksChecked: links,
    searchDocuments: search.length,
    shadcnStoryRendered: true,
    privateContentExcluded: true,
  }),
);
