/* 퍼지 검색: 띄어쓰기·오타·초성·영타(한글 키보드 상태에서 영어로 친 글자) 모두 허용.
   OCSearch.score(query, docText) → 0이면 불일치, 클수록 잘 맞음. */
(function () {
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  // 겹모음·겹받침은 낱자로 풀어서 비교 (타자 순서와 맞추기 위해)
  const SPLIT = {
    ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅐ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅔ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ',
    ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ',
  };
  const ENG = {
    q: 'ㅂ', w: 'ㅈ', e: 'ㄷ', r: 'ㄱ', t: 'ㅅ', y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', p: 'ㅔ',
    a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ', h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
    z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ', b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
    Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ', O: 'ㅒ', P: 'ㅖ',
  };
  const flat = (c) => (SPLIT[c] ? SPLIT[c] : c);

  // 글자 → 자모 나열 (한글 음절은 초·중·종성으로 분해, 나머지는 소문자 그대로, 공백·기호 제거)
  function jamo(str) {
    let out = '';
    for (const ch of String(str || '').toLowerCase()) {
      const code = ch.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const i = code - 0xac00;
        out += flat(CHO[Math.floor(i / 588)]) + flat(JUNG[Math.floor((i % 588) / 28)]) + flat(JONG[i % 28]);
      } else if (/[ㄱ-ㅣ]/.test(ch)) out += flat(ch);
      else if (/[a-z0-9]/.test(ch)) out += ch;
    }
    return out;
  }
  // 초성만 모은 문자열
  function chosung(str) {
    let out = '';
    for (const ch of String(str || '')) {
      const code = ch.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) out += CHO[Math.floor((code - 0xac00) / 588)];
    }
    return out;
  }
  // 영타 → 자모 (예: "qkqtprtm" → ㅂㅏㅂㅅㅔ...)
  const engToJamo = (s) => [...s].map((c) => flat(ENG[c] || '')).join('');

  // 본문(text) 안에서 pattern과 가장 비슷한 부분의 편집거리 (앞뒤는 자유)
  function approxDist(pattern, text, max) {
    const m = pattern.length;
    let prev = Array.from({ length: m + 1 }, (_, i) => i);
    let best = prev[m];
    for (let j = 1; j <= text.length; j++) {
      const cur = [0];
      for (let i = 1; i <= m; i++) {
        cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (pattern[i - 1] === text[j - 1] ? 0 : 1));
      }
      if (cur[m] < best) best = cur[m];
      if (best === 0) return 0;
      prev = cur;
    }
    return best <= max ? best : Infinity;
  }

  // 문서를 미리 분해해 두기
  function prepare(text) {
    return { raw: String(text || '').toLowerCase().replace(/\s+/g, ''), jm: jamo(text), cs: chosung(text) };
  }

  // 단어 하나의 점수 (0 = 불일치)
  function tokenScore(tok, doc) {
    const variants = [tok];
    if (/^[a-zA-Z]+$/.test(tok)) variants.push(engToJamo(tok));
    let best = 0;
    for (const v of variants) {
      const raw = v.toLowerCase();
      const jm = jamo(v);
      if (!jm) continue;
      if (doc.raw.includes(raw)) best = Math.max(best, 100);
      else if (doc.jm.includes(jm)) best = Math.max(best, 85); // "판교도서ㄱ" 처럼 덜 친 글자
      else if (/^[ㄱ-ㅎ]+$/.test(raw) && raw.length >= 2 && doc.cs.includes(raw)) best = Math.max(best, 70); // 초성 검색
      else if (jm.length >= 4) {
        const allow = jm.length >= 9 ? 2 : 1; // 글자 수가 길수록 오타 더 허용
        const d = approxDist(jm, doc.jm, allow);
        if (d <= allow) best = Math.max(best, 55 - d * 10);
      }
    }
    return best;
  }

  // 질문 전체 점수: 모든 단어가 맞으면 합산, 일부만 맞으면 낮은 점수(부분 일치)
  function score(query, doc) {
    const toks = String(query || '').trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return 1;
    let sum = 0;
    let hit = 0;
    for (const t of toks) {
      const s = tokenScore(t, doc);
      if (s) { hit++; sum += s; }
    }
    if (hit === toks.length) {
      // "판교 도서관"처럼 띄어 쓴 말이 붙여 쓴 이름("판교도서관")과 그대로 맞으면 가장 위로
      if (toks.length > 1 && doc.raw.includes(toks.join('').toLowerCase())) sum += 80;
      return sum;
    }
    return hit ? (sum / toks.length) * 0.3 : 0; // 일부 단어만 맞은 후보 (점수 30 이하) — 완전히 맞는 곳이 없을 때만 보여 줌
  }

  window.OCSearch = { prepare, score, jamo, chosung, engToJamo };
})();
