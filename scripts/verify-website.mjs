import assert from 'node:assert/strict';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {JSDOM} from 'jsdom';

const output = fileURLToPath(new URL('../website/dist/', import.meta.url));
const pages = ['index.html', 'playground/index.html'];
for (const page of pages) {
  const path = join(output, page), html = readFileSync(path, 'utf8');
  const document = new JSDOM(html).window.document;
  assert.equal(document.documentElement.lang, 'en');
  assert.match(document.title, /Ontave/);
  assert(document.querySelector('meta[name="description"]')?.getAttribute('content'));
  assert(document.querySelector('link[rel="canonical"]'));
  assert([...document.querySelectorAll('script[src]')].some(script => !script.src.includes('modulepreload-polyfill')), 'Missing interactive entry script');
  for (const script of document.querySelectorAll('script')) {
    assert(script.src && !script.textContent?.trim(), 'Inline or missing production script');
  }
  for (const element of document.querySelectorAll('*')) {
    for (const name of element.getAttributeNames()) assert(!/^on/i.test(name), 'Inline event handler');
  }
  for (const node of document.querySelectorAll('[src], link[href], a[href]')) {
    const attribute = node.hasAttribute('src') ? 'src' : 'href';
    const raw = node.getAttribute(attribute);
    if (!raw || /^(https?:|mailto:|data:)/.test(raw)) continue;
    const url = new URL(raw, `https://ontave.example/${page}`);
    let relative = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const target = resolve(output, relative);
    assert(target.startsWith(output) && existsSync(target), `${page}: missing ${raw}`);
    assert(statSync(target).size > 0, `Empty asset ${raw}`);
    if (url.hash && target.endsWith('.html')) {
      const targetDocument = target === path ? document : new JSDOM(readFileSync(target, 'utf8')).window.document;
      assert(targetDocument.getElementById(decodeURIComponent(url.hash.slice(1))), `${page}: missing anchor ${raw}`);
    }
  }
  if (page === 'index.html') {
    assert.equal(document.querySelectorAll('h1').length, 1);
    assert.match(document.querySelector('h1').textContent, /better question/);
    assert(!html.includes('A data layer that adapts'));
    assert(document.querySelector('#landing-demo'));
    assert(document.querySelector('a[href="/playground/"]'));
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    assert.equal(tabs.length, 3);
    for (const tab of tabs) assert(document.getElementById(tab.getAttribute('aria-controls')));
  }
}
for (const config of ['vercel.json', 'website/vercel.json']) {
  const value = JSON.parse(readFileSync(new URL(`../${config}`, import.meta.url), 'utf8'));
  assert(value.headers.some(rule => rule.headers.some(header => header.key === 'Content-Security-Policy' && !header.value.includes('unsafe-inline'))));
}
console.log('Verified landing page, playground, metadata, local links/assets, code tabs, and production script/CSP boundaries.');
