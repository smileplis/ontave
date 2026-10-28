import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

export default defineConfig({
  resolve: {alias: [
    {find: 'ontave/styles.css', replacement: fileURLToPath(new URL('../src/interactive.css', import.meta.url))},
    {find: 'ontave/react', replacement: fileURLToPath(new URL('../dist/react.js', import.meta.url))},
    {find: 'ontave', replacement: fileURLToPath(new URL('../dist/index.js', import.meta.url))},
  ]},
  server: {fs: {allow: [fileURLToPath(new URL('..', import.meta.url))]}},
  build: {rollupOptions: {input: {
    landing: fileURLToPath(new URL('./index.html', import.meta.url)),
    playground: fileURLToPath(new URL('./playground/index.html', import.meta.url)),
  }}},
});
