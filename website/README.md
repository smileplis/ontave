# Ontave website

Static landing page and documentation. The framework runtime remains in the parent directory and is never imported into browser code.

```sh
npm ci
npm run build
npm run check
npm run dev
```

The build renders Markdown documentation and a React story island. UI primitives come from shadcn/ui; GSAP drives the scroll story and motion. Reduced-motion and short-viewport modes use explicit chapter controls. The output is dist/ with no server, database, key or runtime worker requirement.

Vercel project settings: root directory website, framework Other, build command npm run build, output dist. Node.js 24. Do not add any framework provider keys or database secrets to the static website project.

The requested Sets Grotesk family is used when installed locally; no commercial font file is redistributed. The public fallback is Helvetica Neue/Helvetica/Arial. A licensed webfont kit can be added when supplied by the owner.
