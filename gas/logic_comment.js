// 会員画面のいちばん上に出す「ミヤさんからの一言」。参加の様子から種類を自動で選び、文は日替わり。
// シートには触らない純粋関数。文面は耕平さんの見本（2026-11-16）の口調に合わせて書いた。外部の AI は呼ばない。
//
// 種類（上から順に当てはまったものを使う）
//   免除・部長・副部長 → 出さない
//   welcome   … 登録したがまだ来ていない
//   newbie    … 通算3回まで
//   comeback  … 前回から42日以上あいた
//   milestone … 通算の節目（10・30・50・100…）まであと1〜2回
//   high      … 3回以上連続、または直近2か月の参加率70%以上
//   slow      … 直近2か月の参加率40%未満
//   steady    … それ以外
//   剣豪ポイントがある人は high／steady の日替わりに「剣豪」の文も混ぜる

var COMMENT_MILESTONES = [10, 30, 50, 100, 150, 200, 300, 500, 1000];

var COMMENT_TEXTS = {
  welcome: [
    '登録ありがとうございます！😊\n練習日に会場で［出席する］を押してくださいねー🥊\n初めての方も、みんなで教えるので大丈夫です！👍',
  ],
  newbie: [
    '参加ありがとうございます！😊\n最初は体力がきつくて当たり前です。自分のペースで大丈夫ですよー👍\n不明点はうまい人に聞いてくださいねー！',
    'キックボクシング、楽しんでますか？🥊\n分からないことは、まわりのうまい人に気軽に聞いてくださいねー😊\n続けると、体力もどんどん付いてきます！💪',
    '{total}回目の参加、ありがとうございます！✨\nまずは楽しく体を動かすのが一番です！😊\n次の練習も待ってますよー🥊',
  ],
  comeback: [
    'お久しぶりです！😊\nまた会えるのを楽しみにしてます！🥊\n無理せず、自分のペースで戻ってきてくださいねー👍',
    '最近どうですか？😊\n久しぶりでも、体はちゃんと覚えてます！💪\n次の練習で待ってますよー🥊',
  ],
  milestone: [
    '通算{m}回まで、あと{left}回です！🎉\nこの調子でいきましょう！💪',
    'あと{left}回で通算{m}回達成です！✨\n達成したら、マイページでお祝いが出ますよー🎉',
  ],
  high: [
    '連続参加素晴らしいですね！💪\n連続で参加すると、体力も付いてくるのでその調子です！🔥',
    '新人さんへ教えることで、自分の振り返りやレベルアップにもつながります！✨\nチームを盛り上げるために、協力お願いします！🙌',
    'いつも参加ありがとうございます！😊\n連続で参加すると、体力も付いてくるのでその調子です！💪\n不明点はうまい人に聞いてくださいねー',
    '{streak}回連続の参加、素晴らしいですね！🔥\nチームを盛り上げるために、これからも協力お願いします！🙌',
  ],
  slow: [
    '仕事や家庭で忙しいときもありますよね😊\n来られるときに来るだけで十分です！👍\nみんなで待ってますよー🥊',
    '少し体を動かすだけでも、いいストレス発散になります！💪\n次の練習日、待ってますねー😊',
  ],
  steady: [
    'いつも参加ありがとうございます！😊\n続けることが一番の力になります！💪\n不明点はうまい人に聞いてくださいねー',
    'その調子です！🔥\n参加が増えると、体力もどんどん付いてきますよー💪\nチームを盛り上げるために、協力お願いします！🙌',
  ],
  kengo: [
    'スポーツチャンバラ剣豪⚔️、{kp}ポイント獲得中です！🔥\n次の優勝もねらっていきましょう！💪',
    '剣豪ポイント⚔️{kp}、さすがです！✨\nチャンバラでも、チームを盛り上げてくださいねー🙌',
  ],
};

// 連続参加：今日までに開かれた回（中止を除く）を新しい順に見て、続けて出席している回数。
// 今日の回にまだ来ていないだけなら、途切れたとは数えない
function attendanceStreak(sessions, attendedIds, todayStr) {
  var held = sessions.filter(function (s) { return s.状態 !== '中止' && String(s.日付) <= todayStr; })
    .sort(function (a, b) {
      if (a.日付 !== b.日付) return a.日付 < b.日付 ? 1 : -1;
      return (a.時間帯 === '夜' ? 0 : 1) - (b.時間帯 === '夜' ? 0 : 1);
    });
  var n = 0;
  for (var i = 0; i < held.length; i++) {
    if (attendedIds[held[i].開催ID]) { n++; continue; }
    if (String(held[i].日付) === todayStr && n === 0) continue;
    break;
  }
  return n;
}

function daysBetween(fromStr, toStr) {
  return Math.round((new Date(toStr + 'T00:00:00') - new Date(fromStr + 'T00:00:00')) / 86400000);
}

// 種類を決める。input: { exempt, total, recent（直近2か月の％ or null）, streak, lastDate, kengo, todayStr }
function commentCategory(input) {
  if (input.exempt) return null;
  var total = Number(input.total) || 0;
  if (total === 0) return 'welcome';
  if (total <= 3) return 'newbie';
  if (input.lastDate && daysBetween(input.lastDate, input.todayStr) >= 42) return 'comeback';
  for (var i = 0; i < COMMENT_MILESTONES.length; i++) {
    var left = COMMENT_MILESTONES[i] - total;
    if (left >= 1 && left <= 2) return 'milestone';
    if (left > 2) break;
  }
  if ((Number(input.streak) || 0) >= 3 || (input.recent !== null && input.recent !== undefined && input.recent >= 70)) return 'high';
  if (input.recent !== null && input.recent !== undefined && input.recent < 40) return 'slow';
  return 'steady';
}

// 一言を選ぶ。同じ人・同じ日なら同じ文（日替わり）。戻り値 { category, text, facts } または null
function pickComment(input) {
  var cat = commentCategory(input);
  if (!cat) return null;
  var total = Number(input.total) || 0;
  var streak = Number(input.streak) || 0;
  var kp = Number(input.kengo) || 0;
  var pool = COMMENT_TEXTS[cat].filter(function (t) { return t.indexOf('{streak}') < 0 || streak >= 3; });
  if (kp > 0 && (cat === 'high' || cat === 'steady')) pool = pool.concat(COMMENT_TEXTS.kengo);
  var seed = 0, key = String(input.memberId || '') + String(input.todayStr || '');
  for (var i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) % 100003;
  var m = 0;
  for (var j = 0; j < COMMENT_MILESTONES.length; j++) if (COMMENT_MILESTONES[j] > total) { m = COMMENT_MILESTONES[j]; break; }
  var text = pool[seed % pool.length]
    .replace(/\{total\}/g, total).replace(/\{streak\}/g, streak).replace(/\{kp\}/g, kp)
    .replace(/\{m\}/g, m).replace(/\{left\}/g, m - total);
  // 見出しの横に添える根拠（本人だけが見る画面）
  var facts = [];
  if (input.recent !== null && input.recent !== undefined && total > 3) facts.push('直近2か月 ' + input.recent + '%');
  if (streak >= 2) facts.push(streak + '回連続');
  if (kp > 0) facts.push('⚔️' + kp);
  return { category: cat, text: text, facts: facts.join('・') };
}

if (typeof module !== 'undefined') module.exports = { pickComment, commentCategory, attendanceStreak, COMMENT_TEXTS };
