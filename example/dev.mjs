import postcss from "postcss";
import postcssPxToViewport from "../dist/index.js"
import path, { resolve } from 'node:path';
import {  readFileSync, writeFile } from 'node:fs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// const css = readFileSync(resolve(__dirname, 'main.css'), 'utf8');

const css = `/* viewport-width: 100 */\n  /* simple comment */\n  /* landscape-width: 100 */\n.rule {\n  font-size: 15px;\n  width: 100px;\n  height: 50px;\n}`;

const processedCss = postcss(postcssPxToViewport({
  exclude: [/\/node_modules\//, /\/exclude\//],
  mediaQuery: true,
  landscape: true,
})).process(css, {
  from: '/pc-project/main.css'
}).css;

writeFile(resolve(__dirname, 'main-viewport.css'), processedCss, function (err) {
  if (err) {
    throw err;
  }
  console.log('File with viewport units written.');
});
