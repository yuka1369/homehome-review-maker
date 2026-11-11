import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, normalize, scoreToLabel, TIERS, LIMITS } from '../js/sentiment.js';

const SAMPLE = `日本の家の原風景がここにはあった。
美味しいご飯に、おこたと蜜柑とテレビと団らん。
これが、まさに日本人が失った「幸福」というのでは無いだろうか。
そんな事を思い、朝ご飯を食べながらウルルと目が潤んだ。
オーナーの🦀さんの案内により、那須の魅力がよりヒシヒシと伝わってきた。
できることならまたゆきたい。`;

test('サンプル文は「懐かしさ」クラスタが最強になる', () => {
  const r = analyze(SAMPLE);
  assert.equal(r.clusters[0].id, 'nostalgia');
  assert.ok(['🏡', '🍊', '📺', '🎐'].includes(r.emoji));
  assert.ok(r.score >= 26, `score=${r.score}`);
});

test('同じ入力なら同じ結果（決定的）', () => {
  assert.deepEqual(analyze(SAMPLE), analyze(SAMPLE));
});

test('カタカナ・全角はひらがな・半角に正規化される', () => {
  assert.equal(normalize('ウルル！ＡＢＣ'), 'うるる!abc');
});

test('否定表現はスコアから除外される', () => {
  const r = analyze('美味しくない');
  assert.equal(r.score, 0);
  assert.equal(r.matches[0].negated, true);
  assert.equal(r.emoji, '🙂');
  assert.equal(r.scoreLabel, '100');
});

test('長いキーワードが優先され二重カウントしない', () => {
  const r = analyze('神対応');
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].word, '神対応');
});

test('盛り上げ語で倍率が上がる', () => {
  assert.ok(analyze('本当に最高!!').score > analyze('最高').score);
});

test('スコアが高いほど桁が大きくなる', () => {
  assert.equal(scoreToLabel(0), '100');
  assert.equal(scoreToLabel(999), '∞');
  for (let i = 1; i < TIERS.length; i++) assert.ok(TIERS[i].min > TIERS[i - 1].min);
});

test('異常入力でも例外を投げない・長文は切り詰める', () => {
  for (const v of [undefined, null, '', 123, '<script>alert(1)</script>', '‮abc']) {
    assert.doesNotThrow(() => analyze(v));
  }
  const long = '最高'.repeat(10000);
  const r = analyze(long);
  assert.equal(r.matches.length, LIMITS.text / 2);
});

test('引き直し（salt）で結果が揺らぐ', () => {
  const set = new Set();
  for (let s = 0; s < 10; s++) set.add(analyze(SAMPLE, s).emoji + analyze(SAMPLE, s).scoreLabel);
  assert.ok(set.size > 1);
});
