// ほめほめ感情クラスタリング・エンジン
// - 外部通信なし / 依存なし / 純粋関数のみ（DOM に触れない）
// - レビュー文から「ポジティブ語」を抽出し、感情クラスタごとにスコアを集計する
// - 最も強いクラスタを絵文字に、総スコアを「ふざけた桁」の数値に変換する

/** 感情クラスタ定義。words は [キーワード, 重み]。表記ゆれは normalize() で吸収する。 */
export const CLUSTERS = [
  {
    id: 'gourmet', label: '美味しさ', emojis: ['🍚', '🍣', '🍖', '🍜', '🍛'],
    words: [['美味', 3], ['おいし', 3], ['うま', 2], ['旨', 3], ['絶品', 4], ['ご飯', 1], ['ごはん', 1],
      ['料理', 1], ['朝食', 1], ['夕食', 1], ['ジューシー', 2], ['とろける', 3], ['ふわふわ', 2]],
  },
  {
    id: 'tears', label: '感動', emojis: ['😭', '🥹', '🥲'],
    words: [['感動', 4], ['涙', 3], ['泣', 3], ['潤ん', 3], ['うるうる', 3], ['うるる', 3], ['沁み', 3],
      ['染み', 2], ['胸が熱', 4], ['心を打', 4], ['感激', 3]],
  },
  {
    id: 'nostalgia', label: '懐かしさ', emojis: ['🏡', '🍊', '📺', '🎐'],
    words: [['懐かし', 4], ['原風景', 4], ['ふるさと', 3], ['故郷', 3], ['実家', 3], ['昭和', 2],
      ['こたつ', 3], ['おこた', 3], ['炬燵', 3], ['蜜柑', 2], ['みかん', 2], ['団らん', 3], ['団欒', 3],
      ['縁側', 3], ['田舎', 2]],
  },
  {
    id: 'happy', label: '幸福', emojis: ['🌸', '🍀', '🌈', '☀️'],
    words: [['幸福', 4], ['幸せ', 4], ['しあわせ', 4], ['嬉し', 3], ['うれし', 3], ['楽し', 3],
      ['笑顔', 3], ['ほっこり', 3], ['癒', 3], ['満足', 2], ['満喫', 3], ['くつろ', 2]],
  },
  {
    id: 'kind', label: 'おもてなし', emojis: ['🙏', '🤝', '💐'],
    words: [['親切', 3], ['丁寧', 3], ['優し', 3], ['やさし', 3], ['おもてなし', 4], ['案内', 2],
      ['気配り', 3], ['温か', 3], ['あたたか', 3], ['ありがと', 3], ['感謝', 3], ['神対応', 4]],
  },
  {
    id: 'beauty', label: '絶景・魅力', emojis: ['🌅', '🗻', '✨', '🌌'],
    words: [['綺麗', 3], ['きれい', 3], ['美し', 3], ['絶景', 4], ['景色', 2], ['魅力', 3], ['素敵', 3],
      ['すてき', 3], ['映え', 2], ['清潔', 2], ['おしゃれ', 2], ['お洒落', 2]],
  },
  {
    id: 'hype', label: '最高', emojis: ['🚀', '🔥', '👑', '💯'],
    words: [['最高', 4], ['すご', 3], ['凄', 3], ['やば', 2], ['神', 3], ['優勝', 4], ['完璧', 4],
      ['天才', 4], ['ひしひし', 2], ['圧倒', 3], ['感服', 3], ['至高', 4], ['エモ', 2], ['えも', 2]],
  },
  {
    id: 'cute', label: '尊さ', emojis: ['🐱', '🥰', '💕', '🐣'],
    words: [['かわい', 3], ['可愛', 3], ['もふ', 3], ['尊', 4], ['愛おし', 4], ['推せ', 3], ['推し', 2]],
  },
  {
    id: 'again', label: 'リピート欲', emojis: ['🔁', '🎫', '🧳'],
    words: [['また行き', 4], ['またゆき', 4], ['また来', 4], ['また泊ま', 4], ['また食べ', 4],
      ['リピ', 3], ['おすすめ', 3], ['お勧め', 3], ['オススメ', 3], ['一生通', 4], ['住みた', 4]],
  },
];

/** 盛り上げ語（全体倍率を上げる） */
const INTENSIFIERS = ['とても', 'すごく', '本当に', 'ほんとうに', 'ほんとに', 'まさに', 'めちゃ', '超', '心から',
  '一番', 'いちばん', '最も', '圧倒的', '何度も', 'ぜひ', '是非'];

/** 否定（「美味しくない」等）。キーワード直後の数文字だけを見る。 */
const NEGATION_AFTER = /^[ぁ-ゖ]{0,2}(くない|くなかった|じゃない|ではない|でない|ません|なかった)/u;

/** 数値の「ふざけ桁」テーブル。min 以上のスコアでその段に入る。 */
export const TIERS = [
  { min: 0, values: ['100'] },
  { min: 4, values: ['1000', '3000'] },
  { min: 8, values: ['1万', '5万'] },
  { min: 13, values: ['100万', '530万'] },
  { min: 19, values: ['1億', '3億'] },
  { min: 26, values: ['1兆', '8000兆'] },
  { min: 34, values: ['1京', '5000兆'] },
  { min: 44, values: ['1垓', '1恒河沙'] },
  { min: 56, values: ['1那由他', '1不可思議'] },
  { min: 70, values: ['無量大数'] },
  { min: 90, values: ['∞'] },
];

export const LIMITS = Object.freeze({ text: 600 });

/** カタカナ→ひらがな、全角半角統一、小文字化 */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** FNV-1a 32bit（見た目の揺らぎ用。暗号用途ではない） */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 長いキーワードから先にマッチさせる（「また行き」等を優先し、重複カウントを防ぐ）
const KEYWORDS = CLUSTERS.flatMap((c) =>
  c.words.map(([w, weight]) => ({ key: normalize(w), raw: w, weight, cluster: c.id })),
).sort((a, b) => b.key.length - a.key.length);

/**
 * レビュー文を解析する。
 * @param {string} text
 * @param {number} [salt=0] 「引き直し」用の揺らぎ
 */
export function analyze(text, salt = 0) {
  const src = normalize(String(text ?? '').slice(0, LIMITS.text));
  const covered = new Uint8Array(src.length);
  const matches = [];

  for (const kw of KEYWORDS) {
    let from = 0;
    for (;;) {
      const i = src.indexOf(kw.key, from);
      if (i < 0) break;
      from = i + 1;
      const end = i + kw.key.length;
      let overlap = false;
      for (let j = i; j < end; j++) if (covered[j]) { overlap = true; break; }
      if (overlap) continue;
      covered.fill(1, i, end);
      const negated = NEGATION_AFTER.test(src.slice(end, end + 6));
      matches.push({ word: kw.raw, cluster: kw.cluster, weight: negated ? 0 : kw.weight, negated, index: i });
    }
  }
  matches.sort((a, b) => a.index - b.index);

  const intensifierCount = INTENSIFIERS.reduce((n, w) => n + countOf(src, normalize(w)), 0);
  const bangCount = countOf(src, '!');
  const intensity = Math.min(2.5, 1 + 0.15 * intensifierCount + 0.1 * Math.min(bangCount, 5));

  const clusters = CLUSTERS.map((c) => {
    const ms = matches.filter((m) => m.cluster === c.id && !m.negated);
    return { id: c.id, label: c.label, score: ms.reduce((n, m) => n + m.weight, 0), words: ms.map((m) => m.word) };
  }).filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || CLUSTERS.findIndex((x) => x.id === a.id) - CLUSTERS.findIndex((x) => x.id === b.id));

  const base = clusters.reduce((n, c) => n + c.score, 0);
  const score = Math.round(base * intensity * 10) / 10;
  const seed = (hash(src) + salt * 9) >>> 0;

  const top = clusters[0] ? CLUSTERS.find((c) => c.id === clusters[0].id) : null;
  const emoji = top ? pick(top.emojis, seed) : '🙂';

  return { emoji, scoreLabel: scoreToLabel(score, seed), score, intensity, clusters, matches };
}

export function scoreToLabel(score, seed = 0) {
  let tier = TIERS[0];
  for (const t of TIERS) if (score >= t.min) tier = t;
  return pick(tier.values, seed >>> 3);
}

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

function countOf(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}
