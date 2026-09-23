// v2/style.css を v2/*.html の <style id="app-css"> に埋め込む。
// 外部CSSは拡張機能にブロックされたり、HTMLとCSSでキャッシュがズレると色が出ないため、
// 画面を自己完結させる。スタイルの編集は style.css 側で行い、このスクリプトで反映する。
//   npm.cmd run build
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'v2');
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8').trim();
const block = '<style id="app-css">\n' + css + '\n</style>';
const pages = ['checkin.html', 'admin.html'];

for (const page of pages) {
  const file = path.join(dir, page);
  let html = fs.readFileSync(file, 'utf8');
  const link = /<link rel="stylesheet" href="style\.css[^"]*">/;
  const existing = /<style id="app-css">[\s\S]*?<\/style>/;

  if (existing.test(html)) {
    html = html.replace(existing, block);
  } else if (link.test(html)) {
    html = html.replace(link, block);
  } else {
    throw new Error(page + ' に <link rel="stylesheet"> も <style id="app-css"> も見つかりません');
  }
  fs.writeFileSync(file, html);
  console.log(page + ' に style.css を埋め込みました（' + css.length + ' 文字）');
}
