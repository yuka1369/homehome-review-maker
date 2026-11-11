// UI 層。ユーザー入力は textContent / Canvas fillText でのみ描画し、HTML として解釈させない。
import { analyze, hash, LIMITS } from './sentiment.js';

const MAX = Object.freeze({ account: 30, target: 40, review: LIMITS.text });
const AVATAR_COLORS = ['#8ab4f8', '#f28b82', '#fdd663', '#81c995', '#c58af9', '#78d9ec', '#fcad70'];
const HASHTAG = '#ほめほめプレビューメイカー';
const FILE_NAME = 'homehome-review.png'; // ファイル名に入力値を使わない

const $ = (id) => document.getElementById(id);
const els = {
  form: $('form'), account: $('account'), target: $('target'), review: $('review'),
  pvTarget: $('pv-target'), pvAccount: $('pv-account'), pvScore: $('pv-score'), pvBody: $('pv-body'),
  card: $('card'), clusters: $('clusters'), meta: $('meta'), status: $('status'),
  tabEdit: $('tab-edit'), tabPreview: $('tab-preview'), tabBadge: $('tab-badge'),
};

let salt = 0;
let state = null;
let blobCache = null; // { key, blob } 共有ボタンを押した瞬間に渡せるよう事前生成
let blobTimer = 0;

/** 制御文字・双方向制御文字を除去し、長さを制限する */
function clean(value, max, { multiline = false } = {}) {
  let s = String(value ?? '').normalize('NFC');
  s = s.replace(/[‪-‮⁦-⁩‎‏]/g, ''); // Bidi 偽装対策
  s = multiline
    ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\n{4,}/g, '\n\n\n')
    : s.replace(/[\u0000-\u001F\u007F]/g, '');
  return Array.from(s).slice(0, max).join('');
}

function read() {
  return {
    account: clean(els.account.value, MAX.account).trim() || '名無しさん',
    target: clean(els.target.value, MAX.target).trim() || '褒めたいもの',
    review: clean(els.review.value, MAX.review, { multiline: true }).trim(),
  };
}

function render() {
  const input = read();
  const result = analyze(input.review, salt);
  state = { ...input, ...result };

  els.pvTarget.textContent = input.target;
  els.pvAccount.textContent = input.account;
  els.pvScore.textContent = `${result.emoji}${result.scoreLabel}`;
  els.tabBadge.textContent = `${result.emoji}${result.scoreLabel}`;
  els.pvBody.textContent = input.review;
  els.card.style.setProperty('--avatar', AVATAR_COLORS[hash(input.account) % AVATAR_COLORS.length]);

  renderClusters(result);
  for (const key of Object.keys(MAX)) {
    const c = document.querySelector(`.counter[data-for="${key}"]`);
    if (c) c.textContent = `${Array.from(els[key].value).length}/${MAX[key]}`;
  }
  scheduleBlob();
}

const stateKey = () => JSON.stringify([state.account, state.target, state.review, state.emoji, state.scoreLabel]);

function scheduleBlob() {
  clearTimeout(blobTimer);
  blobTimer = setTimeout(async () => {
    const key = stateKey();
    const blob = await makeBlob();
    if (blob && key === stateKey()) blobCache = { key, blob };
  }, 400);
}

function makeBlob() {
  return new Promise((resolve) => drawCard().toBlob(resolve, 'image/png'));
}

async function currentBlob() {
  if (blobCache && blobCache.key === stateKey()) return blobCache.blob;
  return makeBlob();
}

function renderClusters(result) {
  els.clusters.replaceChildren();
  if (result.clusters.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'ポジティブワードが見つかりませんでした。もっと褒めてみよう！（例: 最高、美味しい、感動、また行きたい）';
    els.clusters.append(li);
  }
  const max = Math.max(1, ...result.clusters.map((c) => c.score));
  for (const c of result.clusters) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = c.label;
    const track = document.createElement('span');
    track.className = 'track';
    const fill = document.createElement('span');
    fill.className = 'fill';
    fill.style.width = `${Math.round((c.score / max) * 100)}%`;
    track.append(fill);
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(c.score);
    const words = document.createElement('span');
    words.className = 'words';
    words.textContent = `検出: ${[...new Set(c.words)].join('、')}`;
    li.append(label, track, num, words);
    els.clusters.append(li);
  }
  const negated = result.matches.filter((m) => m.negated).map((m) => m.word);
  els.meta.textContent = `総スコア ${result.score}（盛り上げ倍率 ×${result.intensity.toFixed(2)}）`
    + (negated.length ? ` / 否定として除外: ${negated.join('、')}` : '');
}

let statusTimer = 0;
function setStatus(msg) {
  els.status.textContent = msg;
  els.status.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => els.status.classList.remove('show'), 2200);
}

/* ---------------- 表示切り替え（狭い画面） ---------------- */
function setView(view) {
  document.body.dataset.view = view;
  els.tabEdit.setAttribute('aria-pressed', String(view === 'edit'));
  els.tabPreview.setAttribute('aria-pressed', String(view === 'preview'));
  window.scrollTo({ top: 0 });
}

/* ---------------- 画像書き出し（Canvas） ---------------- */

const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'sans-serif';
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;
const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));

function wrap(ctx, text, width) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const g of graphemes(para)) {
      if (line && ctx.measureText(line + g).width > width) {
        lines.push(line);
        line = g;
      } else {
        line += g;
      }
    }
    lines.push(line);
  }
  return lines;
}

function ellipsize(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  const gs = graphemes(text);
  while (gs.length && ctx.measureText(`${gs.join('')}…`).width > width) gs.pop();
  return `${gs.join('')}…`;
}

function drawCard() {
  const W = 680; const PAD = 28; const SCALE = 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = (px, weight = 400) => `${weight} ${px}px ${FONT}`;

  // レイアウト計算
  ctx.font = font(26);
  const bodyLines = state.review ? wrap(ctx, state.review, W - PAD * 2) : [];
  ctx.font = font(56, 800);
  const scoreText = `${state.emoji}${state.scoreLabel}`;
  const scoreW = ctx.measureText(scoreText).width;
  ctx.font = font(36);
  const starsW = ctx.measureText('★★★★★').width;
  const starsSameLine = scoreW + 24 + starsW <= W - PAD * 2;

  const yRating = 360;
  const yBody = yRating + (starsSameLine ? 70 : 120);
  const LH = 44;
  const yFoot = yBody + bodyLines.length * LH + 24;
  const H = yFoot + 84;

  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ヘッダー
  ctx.fillStyle = '#333';
  ctx.font = font(36);
  ctx.fillText('←', PAD, 70);
  ctx.fillText('⋮', W - PAD - 12, 70);
  ctx.fillStyle = '#1f1f1f';
  ctx.font = font(38, 700);
  ctx.fillText(ellipsize(ctx, state.target, W - 200), 100, 72);

  // タブ
  ctx.font = font(26);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#444';
  ctx.fillText('概要', W / 4, 145);
  ctx.fillStyle = '#0b57d0';
  ctx.font = font(26, 700);
  ctx.fillText('クチコミ', (W * 3) / 4, 145);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#dddddd';
  ctx.fillRect(0, 172, W, 1);
  ctx.fillStyle = '#0b57d0';
  ctx.fillRect(W / 2 + 60, 168, W / 2 - 120, 5);

  // アバター + 名前
  const ax = PAD + 32; const ay = 240;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, ay, 32, 0, Math.PI * 2);
  ctx.fillStyle = AVATAR_COLORS[hash(state.account) % AVATAR_COLORS.length];
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = '#4a7fd6';
  ctx.beginPath(); ctx.arc(ax, ay - 7, 11, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(ax, ay + 28, 22, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#1f1f1f';
  ctx.font = font(30, 700);
  ctx.fillText(ellipsize(ctx, state.account, W - 220), ax + 50, ay + 10);
  ctx.fillStyle = '#444';
  ctx.font = font(30);
  ctx.fillText('⋮', W - PAD - 12, ay + 10);

  // ★100 部分
  ctx.fillStyle = '#1f1f1f';
  ctx.font = font(56, 800);
  ctx.fillText(ellipsize(ctx, scoreText, W - PAD * 2), PAD, yRating);
  ctx.fillStyle = '#f6b400';
  ctx.font = font(36);
  if (starsSameLine) ctx.fillText('★★★★★', PAD + scoreW + 24, yRating - 6);
  else ctx.fillText('★★★★★', PAD, yRating + 52);

  // 本文
  ctx.fillStyle = '#1f1f1f';
  ctx.font = font(26);
  bodyLines.forEach((line, i) => ctx.fillText(line, PAD, yBody + i * LH));

  // フッター
  ctx.fillStyle = '#e3e3e3';
  ctx.fillRect(PAD, yFoot, W - PAD * 2, 1);
  ctx.fillStyle = '#444';
  ctx.font = font(24);
  ctx.fillText('👍 いいね', PAD + 8, yFoot + 46);
  ctx.fillText('🔗 共有', PAD + 190, yFoot + 46);

  return canvas;
}

function saveBlob(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = FILE_NAME;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function download() {
  render();
  const blob = await currentBlob();
  if (!blob) { setStatus('画像の生成に失敗しました'); return; }
  saveBlob(blob);
  setStatus('画像を保存しました🖼');
}

/**
 * スマホ：共有シートで画像ごと X アプリへ（Web Share API）。
 * 非対応ブラウザ（主に PC）：画像を保存し、X の投稿画面を開く（画像は手動で添付）。
 */
async function share() {
  render();
  const text = `${state.target}に${state.emoji}${state.scoreLabel}\n${HASHTAG}`;
  const blob = blobCache && blobCache.key === stateKey() ? blobCache.blob : null;
  const file = blob && typeof File === 'function' ? new File([blob], FILE_NAME, { type: 'image/png' }) : null;

  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // ユーザーがキャンセル
    }
  }
  // フォールバック：ユーザー操作の同期区間で先にウィンドウを開く（ポップアップブロック回避）
  const intent = new URL('https://x.com/intent/post');
  intent.searchParams.set('text', text);
  window.open(intent.toString(), '_blank', 'noopener,noreferrer');
  const b = blob || await currentBlob();
  if (b) saveBlob(b);
  setStatus('画像を保存しました。Xの投稿に添付してください');
}

async function copyText() {
  render();
  const text = `${state.target}\n${state.account}\n${state.emoji}${state.scoreLabel} ★★★★★\n\n${state.review}\n\n${HASHTAG}`;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('テキストをコピーしました📋');
  } catch {
    setStatus('コピーできませんでした');
  }
}

els.form.addEventListener('input', () => { salt = 0; render(); });
els.form.addEventListener('submit', (e) => e.preventDefault());
$('reroll').addEventListener('click', () => { salt += 1; render(); setStatus('引き直しました🎲'); });
$('download').addEventListener('click', download);
$('share').addEventListener('click', share);
els.tabEdit.addEventListener('click', () => setView('edit'));
els.tabPreview.addEventListener('click', () => setView('preview'));
$('copy').addEventListener('click', copyText);

setView('edit');
render();
