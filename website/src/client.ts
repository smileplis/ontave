import { searchDocuments } from "./search";
import React from "react";
import { hydrateRoot } from "react-dom/client";
import { Story } from "./Story";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
const storyRoot = document.getElementById("story-root");
if (storyRoot) hydrateRoot(storyRoot, React.createElement(Story));
const q = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
) => root.querySelector<T>(selector);
const qa = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
) => Array.from(root.querySelectorAll<T>(selector));
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) {
  const el = q("#toast")!;
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 2600);
}
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function highlight(el: HTMLElement) {
  const text = el.textContent || "";
  const re =
    /(\/\/[^\n]*|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:const|let|await|import|from|export|if|else|return|new|throw|async|function|type|interface|true|false|null)\b)/g;
  let last = 0,
    html = "";
  for (const match of text.matchAll(re)) {
    html += escape(text.slice(last, match.index));
    const token = match[0];
    const kind =
      token.startsWith("//") || token.startsWith("#")
        ? "comment"
        : /^["']/.test(token)
          ? "string"
          : "keyword";
    html += `<span class="tok-${kind}">${escape(token)}</span>`;
    last = match.index! + token.length;
  }
  el.innerHTML = html + escape(text.slice(last));
}
qa<HTMLElement>("pre code").forEach(highlight);
document.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    ".copy-code",
  );
  if (!button) return;
  const text = q<HTMLElement>(
    "code",
    button.closest(".code-window")!,
  )?.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch {
    toast("Copy unavailable. Select the code to copy it.");
  }
});
q(".menu-toggle")?.addEventListener("click", () => {
  const menu = q<HTMLElement>(".mobile-nav")!,
    button = q(".menu-toggle")!;
  menu.hidden = !menu.hidden;
  button.setAttribute("aria-expanded", String(!menu.hidden));
  button.setAttribute(
    "aria-label",
    menu.hidden ? "Open navigation" : "Close navigation",
  );
});
qa(".mobile-nav a").forEach((a) =>
  a.addEventListener("click", () => {
    q<HTMLElement>(".mobile-nav")!.hidden = true;
    q(".menu-toggle")!.setAttribute("aria-expanded", "false");
  }),
);
q(".docs-mobile-toggle")?.addEventListener("click", () => {
  const side = q(".docs-sidebar")!;
  const open = side.classList.toggle("open");
  q(".docs-mobile-toggle")!.setAttribute("aria-expanded", String(open));
});
function setupTabs(selector: string, change: (button: HTMLElement) => void) {
  const tabs = qa<HTMLElement>(selector);
  const select = (button: HTMLElement) => {
    tabs.forEach((t) => {
      t.setAttribute("aria-selected", String(t === button));
      t.setAttribute("tabindex", t === button ? "0" : "-1");
    });
    change(button);
  };
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => select(button));
    button.addEventListener("keydown", (e) => {
      let next: number | undefined;
      if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = tabs.length - 1;
      if (next !== undefined) {
        e.preventDefault();
        select(tabs[next]);
        tabs[next].focus();
      }
    });
  });
  return select;
}
const features: Record<
  string,
  {
    title: string;
    description: string;
    symbol: string;
    link: string;
    label: string;
    detail: string;
    filename: string;
    code: string;
  }
> = {
  evidence: {
    title: "A source for\nevery assertion.",
    description:
      "Preserve the message before interpreting it. Every proposed value points back to a quote, a JSON path or an exact byte span.",
    symbol: "↳",
    link: "evidence",
    label: "Explore evidence",
    detail: "Receipt ≠ accepted fact",
    filename: "preserve.ts",
    code: `const receipt = await ontave.ingest(context, {
  source: "messages",
  idempotencyKey: "message-014",
  payload: {
    kind: "text",
    text: "Ramesh needs to inspect the roof.",
  },
});

// Preserved now. Interpreted by your worker.
const job = await ontave.jobs.get(
  context, receipt.job_id,
);`,
  },
  review: {
    title: "Approval is a step\nin the API.",
    description:
      "Inspect a staged bundle. Resolve its dependencies. Accept the exact revision you reviewed, with a recorded decision and reason.",
    symbol: "✓",
    link: "review",
    label: "Understand review",
    detail: "Acceptance ≠ independent verification",
    filename: "review.ts",
    code: `const bundle = await ontave.reviews.get(
  context, bundleId,
);

// After an authorized reviewer checks it:
await ontave.reviews.accept(context, {
  bundleId: bundle.id,
  digest: bundle.hash,
  requestKey: "review-message-014",
  reason: "Checked the proposal against its source",
});

// A modified bundle requires a new review.`,
  },
  evolve: {
    title: "A new concept.\nA deliberate change.",
    description:
      "Propose an additive extension from selected evidence. Compare it against the parent with a frozen evaluation suite, then explicitly activate it.",
    symbol: "◇",
    link: "evolution",
    label: "Explore model evolution",
    detail: "Candidate activation ≠ fact acceptance",
    filename: "evolve.ts",
    code: `const candidate = await ontave.ontology.propose(
  context, {
    evidenceIds: [evidenceId],
    requestKey: "roof-inspection-v1",
    reason: "An inspection precedes installation",
    patch: reviewedAdditiveDefinition,
  },
);

const evaluation = await ontave.evaluations.evaluate(
  context, { candidateId: candidate.candidateId, suiteId },
);
// Inspect the report before explicit publication.`,
  },
  read: {
    title: "Current data.\nA known shape.",
    description:
      "Pin an application contract and query accepted data through a bounded, structured interface. Values arrive with verification and provenance.",
    symbol: "⌑",
    link: "queries",
    label: "Explore structured reads",
    detail: "Database read · zero inference calls",
    filename: "read.ts",
    code: `const page = await ontave.entities.find(context, {
  contractId: contract.id,
  contractHash: contract.hash,
  conceptId: "person",
  where: [{ field: "name", op: "eq", value: "Ramesh" }],
  limit: 25,
});

const name = page.records[0]?.fields.name;
if (name?.state === "value") {
  console.log(name.value, name.verification);
  console.log(name.assertionIds);
}`,
  },
};
setupTabs("[data-feature]", (button) => {
  const item = features[button.dataset.feature!];
  q<HTMLElement>("#feature-title")!.innerHTML = item.title
    .split("\n")
    .map(escape)
    .join("<br>");
  q("#feature-description")!.textContent = item.description;
  q("#feature-symbol")!.textContent = item.symbol;
  const link = q<HTMLAnchorElement>("#feature-link")!;
  link.href = `/docs/${item.link}/`;
  link.innerHTML = `${escape(item.label)} <span>↗</span>`;
  q("#feature-detail")!.innerHTML =
    `<span class="status-light"></span> ${escape(item.detail)}`;
  q("#feature-code")!.innerHTML =
    `<div class="code-window"><div class="code-toolbar"><span><i></i>${escape(item.filename)}</span><button class="copy-code" aria-label="Copy code">Copy <span aria-hidden="true">⧉</span></button></div><pre><code>${escape(item.code)}</code></pre></div>`;
  highlight(q<HTMLElement>("#feature-code code")!);
  q("#feature-panel")!.setAttribute("aria-labelledby", button.id);
});
const dialog = q<HTMLDialogElement>("#search-dialog")!;
const input = q<HTMLInputElement>("#docs-search")!;
const results = q("#search-results")!;
let index:
  | { title: string; description: string; path: string; text: string }[]
  | undefined;
let searchSequence = 0;
async function renderSearch() {
  const sequence = ++searchSequence;
  const query = input.value.toLowerCase().trim();
  if (!index) {
    try {
      const response = await fetch("/search-index.json");
      if (!response.ok) throw Error();
      index = await response.json();
    } catch {
      results.innerHTML =
        '<p class="search-empty">Search could not load. <a href="/docs/">Browse the documentation →</a></p>';
      return;
    }
  }
  if (sequence !== searchSequence) return;
  const matches = searchDocuments(index!, query);
  results.replaceChildren();
  if (!matches.length) {
    const p = document.createElement("p");
    p.className = "search-empty";
    p.textContent = `No results for “${input.value}”. Try “evidence”, “review” or “contracts”.`;
    results.append(p);
  }
  for (const entry of matches) {
    const a = document.createElement("a");
    a.href = entry.path;
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const description = document.createElement("p");
    description.textContent = entry.description;
    a.append(title, description);
    results.append(a);
  }
}
function openSearch() {
  dialog.showModal();
  input.focus();
  renderSearch();
}
qa(".search-trigger").forEach((button) =>
  button.addEventListener("click", openSearch),
);
input.addEventListener("input", renderSearch);
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    q<HTMLAnchorElement>("#search-results a")?.focus();
  }
  if (e.key === "Enter") {
    e.preventDefault();
    q<HTMLAnchorElement>("#search-results a")?.click();
  }
});
results.addEventListener("keydown", (e) => {
  const ev = e as KeyboardEvent;
  const links = qa<HTMLAnchorElement>("a", results);
  const current = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (current === 0 && ev.key === "ArrowUp") input.focus();
    else
      links[
        (current + (ev.key === "ArrowDown" ? 1 : -1) + links.length) %
          links.length
      ]?.focus();
  }
});
document.addEventListener("keydown", (e) => {
  const target = e.target as Element;
  const editing = target.matches("input,textarea,[contenteditable=true]");
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    dialog.open ? dialog.close() : openSearch();
  } else if (e.key === "/" && !editing && !dialog.open) {
    e.preventDefault();
    openSearch();
  }
  if (e.key === "Escape") {
    q<HTMLElement>(".mobile-nav")!.hidden = true;
    q(".menu-toggle")!.setAttribute("aria-expanded", "false");
    q(".docs-sidebar")?.classList.remove("open");
    q(".docs-mobile-toggle")?.setAttribute("aria-expanded", "false");
  }
});
const headings = qa<HTMLElement>(".docs-prose h2,.docs-prose h3");
if (headings.length && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          qa(".docs-toc a").forEach((a) =>
            a.classList.toggle(
              "active",
              a.getAttribute("href") === "#" + entry.target.id,
            ),
          );
        }
      }
    },
    { rootMargin: "-15% 0px -65% 0px" },
  );
  headings.forEach((h) => observer.observe(h));
}

const motion = gsap.matchMedia();
motion.add("(prefers-reduced-motion: no-preference)", () => {
  gsap.from(".hero h1,.hero-copy,.hero-actions", {
    y: 25,
    opacity: 0,
    duration: 1.1,
    stagger: 0.13,
    ease: "power3.out",
    delay: 0.08,
  });
  qa<HTMLElement>(".section:not(.walkthrough) .section-title").forEach(
    (section) =>
      gsap.from(section, {
        y: 27,
        opacity: 0,
        duration: 0.9,
        ease: "power2.out",
        scrollTrigger: { trigger: section, start: "top 88%", once: true },
      }),
  );
  document.querySelectorAll<HTMLAnchorElement>('a[href^="/#"]').forEach((a) =>
    a.addEventListener("click", (event) => {
      if (location.pathname !== "/") return;
      const hash = new URL(a.href).hash;
      const element = document.getElementById(hash.slice(1));
      if (!element) return;
      event.preventDefault();
      history.pushState(null, "", hash);
      gsap.to(window, {
        scrollTo: { y: element, offsetY: 90 },
        duration: 1.1,
        ease: "power3.inOut",
        overwrite: "auto",
      });
    }),
  );
});
