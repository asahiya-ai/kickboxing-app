const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 画面（HTML）の中の <script> が壊れていないか（文字列の途中に改行が入る等で画面全体が動かなくなるのを防ぐ）
for (const page of ['checkin.html', 'admin.html']) {
  test(page + ' のスクリプトが構文エラーなく読める', () => {
    const html = fs.readFileSync(__dirname + '/../v2/' + page, 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(scripts.length > 0);
    scripts.forEach(src => assert.doesNotThrow(() => new vm.Script(src, { filename: page })));
  });
}
