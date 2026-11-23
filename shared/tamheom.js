/*
 * 수학 탐험대 공통 틀
 * docs/autism-teaching-guide.md 의 원칙을 모든 활동에 똑같이 적용합니다.
 *  - 같은 순서: 시작 화면 → 짧은 설명(예시 1개) → 문제 → 끝 화면
 *  - 연잎 진행 표시, 버튼 위치 고정, 시간 제한 없음
 *  - 정답이면 무작위 음성 칭찬 ("잘했어!", "훌륭해!", "대단해!"), 틀리면 차분하게 다시
 *  - 난이도 단계(어른 설정), 맞히면 단계 올리기 / 두 번 틀리면 단계 낮추기
 *  - 틀린 문제는 1일 → 3일 → 7일 뒤 다시 나오는 복습 (이 기기에만 저장)
 *
 * 사용법 (활동 페이지):
 *   Tamheom.activity({
 *     id, title, emoji, subtitle,
 *     levels: [{ name, desc }, ...],          // 1단계부터
 *     options: [{ key, label, choices: [{ value, label }], value }],  // 선택
 *     intro(el, ctx) { ... },                  // 짧은 설명 화면
 *     question(el, ctx) { ... }                // 문제 하나를 el 안에 그림
 *   });
 *   question 안에서: ctx.setData(data) → 정답이면 ctx.correct('무엇을 잘했는지'),
 *   틀리면 ctx.wrong() (틀린 횟수를 돌려줌). ctx.review 가 있으면 그 data로 문제를 다시 만듭니다.
 */
(function (global) {
  'use strict';

  /* ---------- 저장 (이 기기 브라우저에만) ---------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('th:' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('th:' + key, JSON.stringify(value)); } catch (e) { /* 저장 못 해도 동작 */ }
    },
    remove(key) {
      try { localStorage.removeItem('th:' + key); } catch (e) { /* 무시 */ }
    }
  };

  const DEFAULTS = {
    count: 8,          // 한 번에 풀 문제 수
    hintDelay: 3,      // 힌트 기다리는 시간(초), -1 = 끔
    showIntro: true,   // 처음에 설명 보기
    sound: true,       // 칭찬 목소리
    autoUp: true,      // 바로 3번 맞히면 단계 올리기
    autoDown: true     // 한 문제를 2번 틀리면 다음 문제 단계 낮추기
  };
  function loadSettings() { return Object.assign({}, DEFAULTS, store.get('settings', {})); }
  function saveSettings(s) { store.set('settings', s); }

  const DAY = 24 * 60 * 60 * 1000;
  const REVIEW_GAPS = [1, 3, 7]; // 일

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------- 음성 칭찬 (브라우저 기본 목소리) ---------- */
  const hasSpeech = 'speechSynthesis' in global && 'SpeechSynthesisUtterance' in global;
  // 한국어 목소리만 씁니다. 목소리 목록은 늦게 도착하는 경우가 많아서(크롬, 사파리)
  // 말할 때마다 다시 찾고, 한국어 목소리가 없으면 외국어 목소리로 읽지 않고 조용히 넘어갑니다.
  let koVoice = null;
  const isKo = v => /^ko([-_]|$)/i.test(v.lang || '');
  function pickVoice() {
    try {
      const voices = global.speechSynthesis.getVoices().filter(isKo);
      const saved = loadSettings().voiceName;
      koVoice = (saved && voices.find(v => v.name === saved)) ||
                voices.find(v => /yuna|유나/i.test(v.name) && v.localService) ||
                voices.find(v => /yuna|유나/i.test(v.name)) ||
                voices.find(v => v.localService) ||
                voices[0] || null;
    } catch (e) { koVoice = null; }
    return koVoice;
  }
  if (hasSpeech) {
    pickVoice();
    try { global.speechSynthesis.addEventListener('voiceschanged', pickVoice); }
    catch (e) { global.speechSynthesis.onvoiceschanged = pickVoice; }
  }
  function speak(text) {
    if (!hasSpeech || !loadSettings().sound) return;
    if (!koVoice) pickVoice();
    if (!koVoice) return;                       // 한국어 목소리가 없으면 말하지 않음
    try {
      const synth = global.speechSynthesis;
      if (synth.speaking || synth.pending) synth.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N}\s!?.,]/gu, ''));
      u.voice = koVoice;
      u.lang = koVoice.lang.replace('_', '-');
      u.rate = 0.95;
      u.pitch = 1.1;
      u.volume = 1;
      synth.speak(u);
    } catch (e) { /* 목소리가 없어도 글자 칭찬은 보임 */ }
  }

  const PRAISE = ['잘했어!', '훌륭해!', '대단해!'];
  let lastPraise = -1;
  function randomPraise() {
    let i;
    do { i = Math.floor(Math.random() * PRAISE.length); } while (i === lastPraise);
    lastPraise = i;
    return PRAISE[i];
  }

  /* ---------- 작은 도우미 ---------- */
  function h(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

  // 숫자 뒤 조사: 14를, 12는, 3은 ... (한자어 수 읽기 기준: 영 일 삼 육 칠 팔 십 백 은 받침 있음)
  function josa(n, withBatchim, without) {
    const last = Math.abs(n) % 10;
    const has = [0, 1, 3, 6, 7, 8].includes(last);
    return n + (has ? withBatchim : without);
  }
  // 세로 분수 (글 속에 넣는 작은 분수). 조사는 분자 읽기를 따름: 7분의 2"는"
  function fracHTML(n, d) {
    return `<span class="th-mini-frac" aria-label="${d}분의 ${n}"><span>${n}</span><span>${d}</span></span>`;
  }
  function fracJosa(n, d, withBatchim, without) {
    const has = [0, 1, 3, 6, 7, 8].includes(Math.abs(n) % 10);
    return fracHTML(n, d) + (has ? withBatchim : without);
  }

  /* ---------- 숫자 칸 + 화면 키패드 ----------
   * 아이패드에서 시스템 키보드가 화면을 가리지 않도록 화면 키패드를 씁니다.
   */
  function slot(opts) {
    opts = opts || {};
    const max = opts.max || 2;
    const el = h('button', 'th-slot' + (opts.small ? ' th-slot-sm' : ''));
    el.type = 'button';
    el.setAttribute('aria-label', opts.label || '숫자 칸');
    let value = '';
    const s = {
      el, max,
      get value() { return value; },
      get number() { return value === '' ? NaN : parseInt(value, 10); },
      set(v) { value = String(v); el.textContent = value; el.classList.remove('is-wrong'); },
      clear() { value = ''; el.textContent = ''; el.classList.remove('is-wrong', 'is-right'); },
      type(d) {
        if (el.classList.contains('is-right') || el.disabled) return false;
        if (value.length >= max) return false;
        value = (value === '0' ? '' : value) + d;
        el.textContent = value;
        el.classList.remove('is-wrong');
        return value.length >= max;
      },
      back() { value = value.slice(0, -1); el.textContent = value; el.classList.remove('is-wrong'); },
      mark(state) {
        el.classList.remove('is-wrong', 'is-right');
        if (state) el.classList.add('is-' + state);
      },
      lock() { el.disabled = true; }
    };
    if (opts.value != null) s.set(opts.value);
    return s;
  }

  function fraction(opts) {
    opts = opts || {};
    const wrap = h('div', 'th-frac');
    const num = slot({ max: opts.max || 2, label: '분자' });
    const den = slot({ max: opts.max || 2, label: '분모' });
    wrap.appendChild(num.el);
    wrap.appendChild(h('div', 'th-frac-line'));
    wrap.appendChild(den.el);
    return { el: wrap, num, den, slots: [num, den] };
  }

  let activePad = null;
  function keypad(opts) {
    // opts: { slots, onCheck, checkLabel }
    const wrap = h('div', 'th-answer');
    const pad = h('div', 'th-keypad');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'clear'];
    const api = { el: wrap, slots: [], active: null };

    keys.forEach(k => {
      const b = h('button', 'th-key' + (k.length > 1 ? ' th-key-fn' : ''));
      b.type = 'button';
      b.textContent = k === 'back' ? '⌫' : k === 'clear' ? '지우기' : k;
      b.setAttribute('aria-label', k === 'back' ? '한 글자 지우기' : k === 'clear' ? '칸 비우기' : k);
      b.addEventListener('click', () => press(k));
      pad.appendChild(b);
    });
    const check = h('button', 'th-btn th-btn-primary th-check', opts.checkLabel || '확인 🎯');
    check.type = 'button';
    check.addEventListener('click', () => opts.onCheck && opts.onCheck());
    wrap.appendChild(pad);
    wrap.appendChild(check);

    function select(s) {
      api.slots.forEach(x => x.el.classList.remove('is-active'));
      api.active = s;
      if (s) s.el.classList.add('is-active');
    }
    function press(k) {
      const s = api.active;
      if (!s) return;
      if (k === 'back') return s.back();
      if (k === 'clear') return s.clear();
      const full = s.type(k);
      if (full) {
        const i = api.slots.indexOf(s);
        const nextEmpty = api.slots.slice(i + 1).find(x => x.value === '' && !x.el.disabled);
        if (nextEmpty) select(nextEmpty);
      }
    }
    api.press = press;
    api.check = () => opts.onCheck && opts.onCheck();
    api.setSlots = function (slots) {
      api.slots.forEach(s => { s.el.onclick = null; s.el.classList.remove('is-active', 'is-open'); });
      api.slots = slots.filter(Boolean);
      api.slots.forEach(s => {
        s.el.classList.add('is-open');
        s.el.onclick = () => select(s);
      });
      select(api.slots.find(s => s.value === '' && !s.el.disabled) || api.slots[0] || null);
    };
    api.select = select;
    api.setCheckLabel = t => { check.textContent = t; };
    api.setSlots(opts.slots || []);
    activePad = api;
    return api;
  }

  document.addEventListener('keydown', e => {
    if (!activePad || !document.body.contains(activePad.el)) return;
    if (/^[0-9]$/.test(e.key)) { activePad.press(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { activePad.press('back'); e.preventDefault(); }
    else if (e.key === 'Enter') { activePad.check(); e.preventDefault(); }
    else if (e.key === 'Tab') {
      const s = activePad.slots;
      if (!s.length) return;
      const i = s.indexOf(activePad.active);
      activePad.select(s[(i + (e.shiftKey ? s.length - 1 : 1)) % s.length]);
      e.preventDefault();
    }
  });

  /* ---------- 활동 진행 틀 ---------- */
  function activity(cfg) {
    const id = cfg.id;
    const levels = cfg.levels;
    const home = cfg.home || '../../index.html';
    const optionDefaults = {};
    (cfg.options || []).forEach(o => { optionDefaults[o.key] = o.value; });
    const getOpts = () => Object.assign({}, optionDefaults, store.get('opt:' + id, {}));
    const getStartLevel = () => Math.min(levels.length, Math.max(1, store.get('level:' + id, 1)));

    document.body.classList.add('th');
    if (cfg.accent) document.documentElement.style.setProperty('--accent', cfg.accent);
    if (cfg.accentSoft) document.documentElement.style.setProperty('--accent-soft', cfg.accentSoft);
    document.body.innerHTML = '';

    const app = h('div', 'th-app');
    app.innerHTML = `
      <header class="th-top">
        <a class="th-icon-btn" href="${home}" aria-label="처음 화면으로">🏠</a>
        <div class="th-title">${cfg.emoji} ${cfg.title}</div>
        <button type="button" class="th-icon-btn th-sound" aria-label="소리 켜기/끄기"></button>
      </header>

      <section class="th-screen th-start">
        <div class="th-big-emoji">${cfg.emoji}</div>
        <h1>${cfg.title}</h1>
        <p class="th-sub">${cfg.subtitle || ''}</p>
        <p class="th-start-info"></p>
        <button type="button" class="th-btn th-btn-primary th-btn-xl th-go">시작하기 ▶</button>
        <button type="button" class="th-link-btn th-open-settings">⚙️ 어른 설정</button>
      </section>

      <section class="th-screen th-intro">
        <div class="th-card th-intro-card">
          <h2>🐸 이렇게 해요</h2>
          <div class="th-intro-body"></div>
        </div>
        <div class="th-bottom">
          <button type="button" class="th-btn th-btn-primary th-btn-xl th-intro-go">알겠어! 문제 풀기 ▶</button>
        </div>
      </section>

      <section class="th-screen th-play">
        <div class="th-pads" aria-label="진행"></div>
        <div class="th-level-tag"></div>
        <div class="th-card th-q"></div>
        <div class="th-bottom th-bottom-play">
          <div class="th-feedback" role="status" aria-live="polite"></div>
          <button type="button" class="th-btn th-btn-primary th-btn-xl th-next">다음 문제 ➡️</button>
        </div>
      </section>

      <section class="th-screen th-end">
        <div class="th-sticker">🐸</div>
        <h1>다 했어!</h1>
        <p class="th-end-text"></p>
        <div class="th-sticker-row"></div>
        <div class="th-end-btns">
          <button type="button" class="th-btn th-btn-primary th-btn-xl th-again">한 번 더 ▶</button>
          <a class="th-btn th-btn-quiet th-btn-xl" href="${home}">🏠 처음으로</a>
        </div>
      </section>

      <div class="th-overlay" hidden>
        <div class="th-panel" role="dialog" aria-modal="true" aria-label="어른 설정">
          <div class="th-panel-head">
            <h2>⚙️ 어른 설정</h2>
            <button type="button" class="th-icon-btn th-close-settings" aria-label="닫기">✕</button>
          </div>
          <div class="th-panel-body"></div>
        </div>
      </div>`;
    document.body.appendChild(app);

    const $ = sel => app.querySelector(sel);
    const screens = { start: $('.th-start'), intro: $('.th-intro'), play: $('.th-play'), end: $('.th-end') };
    function show(name) {
      Object.entries(screens).forEach(([k, el]) => { el.classList.toggle('is-shown', k === name); });
      global.scrollTo(0, 0);
    }

    /* 소리 버튼 */
    const soundBtn = $('.th-sound');
    function paintSound() { soundBtn.textContent = loadSettings().sound ? '🔊' : '🔇'; }
    soundBtn.addEventListener('click', () => {
      const s = loadSettings(); s.sound = !s.sound; saveSettings(s); paintSound();
      if (s.sound) speak('잘했어!');
    });
    paintSound();

    /* ----- 복습 ----- */
    const rk = 'review:' + id;
    const keyOf = d => JSON.stringify(d);
    function dueReviews() {
      const now = Date.now();
      return store.get(rk, []).filter(r => r.due <= now);
    }
    function addReview(data) {
      if (!data) return;
      const list = store.get(rk, []);
      const k = keyOf(data);
      const found = list.find(r => keyOf(r.data) === k);
      if (found) { found.due = Date.now() + DAY; found.step = 0; }
      else list.push({ data, due: Date.now() + DAY, step: 0 });
      store.set(rk, list.slice(-40));
    }
    function finishReview(data, firstTry) {
      const list = store.get(rk, []);
      const k = keyOf(data);
      const i = list.findIndex(r => keyOf(r.data) === k);
      if (i < 0) return;
      if (!firstTry) { list[i].step = 0; list[i].due = Date.now() + DAY; }
      else {
        list[i].step += 1;
        if (list[i].step >= REVIEW_GAPS.length) list.splice(i, 1);
        else list[i].due = Date.now() + REVIEW_GAPS[list[i].step] * DAY;
      }
      store.set(rk, list);
    }

    /* ----- 기록 ----- */
    function logResult(firstTry) {
      const log = store.get('log:' + id, {});
      const t = today();
      log[t] = log[t] || { first: 0, total: 0 };
      log[t].total += 1;
      if (firstTry) log[t].first += 1;
      store.set('log:' + id, log);
    }

    /* ----- 시작 화면 ----- */
    function paintStart() {
      const n = dueReviews().length;
      const lv = levels[getStartLevel() - 1];
      $('.th-start-info').innerHTML =
        `${getStartLevel()}단계 · ${lv.name} · ${loadSettings().count}문제` +
        (n ? `<br><span class="th-review-badge">🔁 다시 풀어 볼 문제 ${Math.min(n, 2)}개가 먼저 나와요</span>` : '');
    }

    /* ----- 진행 ----- */
    let session = null;
    let q = null;

    function startSession() {
      const s = loadSettings();
      session = {
        total: s.count,
        index: 0,
        level: getStartLevel(),
        queue: dueReviews().slice(0, Math.min(2, s.count)),
        firstTries: 0,
        streak: 0
      };
      if (s.showIntro && cfg.intro) {
        const body = $('.th-intro-body');
        body.innerHTML = '';
        cfg.intro(body, { level: session.level, options: getOpts(), fraction, h });
        show('intro');
      } else {
        show('play');
        loadQuestion();
      }
    }

    // 연잎: 지나온 연잎은 진하게, 개구리는 지금 문제 연잎 위에
    function paintPads(hop) {
      const pads = $('.th-pads');
      pads.innerHTML = '';
      const frogAt = Math.min(session.index, session.total - 1);
      for (let i = 0; i < session.total; i++) {
        const p = h('div', 'th-pad' + (i < session.index ? ' is-done' : ''));
        if (i === frogAt) p.appendChild(h('span', 'th-pad-frog' + (hop ? ' is-hop' : ''), '🐸'));
        pads.appendChild(p);
      }
      pads.setAttribute('aria-label', `${session.total}문제 중 ${Math.min(session.index + 1, session.total)}번째`);
    }

    function clearTimers() {
      if (q) q.timers.forEach(t => clearTimeout(t));
    }

    function loadQuestion() {
      clearTimers();
      if (session.index >= session.total) return showEnd();
      paintPads();
      const reviewItem = session.queue.shift() || null;
      q = { wrongs: 0, done: false, data: null, review: reviewItem, timers: [] };
      const lv = levels[session.level - 1];
      $('.th-level-tag').innerHTML =
        (reviewItem ? '<span class="th-review-badge">🔁 다시 풀어 보기</span> ' : '') +
        `<span>${session.level}단계 · ${lv.name}</span>`;
      const fb = $('.th-feedback');
      fb.textContent = '';
      fb.className = 'th-feedback';
      const next = $('.th-next');
      next.classList.remove('is-shown');
      next.textContent = session.index === session.total - 1 ? '끝! 🎉' : '다음 문제 ➡️';

      const el = $('.th-q');
      const bottom = $('.th-bottom-play');
      screens.play.appendChild(bottom);   // 문제를 지우기 전에 피드백 줄을 밖으로
      el.innerHTML = '';
      const s = loadSettings();
      const thisQ = q;
      const ctx = {
        level: session.level,
        maxLevel: levels.length,
        review: reviewItem ? reviewItem.data : null,
        options: getOpts(),
        hintDelay: s.hintDelay,
        setData(d) { thisQ.data = d; },
        // 힌트 대기 시간이 지나면 fn 실행 (끔이면 실행 안 함)
        later(fn) {
          if (s.hintDelay < 0) return;
          thisQ.timers.push(setTimeout(() => { if (!thisQ.done && q === thisQ) fn(); }, s.hintDelay * 1000));
        },
        say(text, kind) { feedback(text, kind || 'info'); },
        speak,
        correct(specific) { onCorrect(thisQ, specific); },
        wrong(msg) { return onWrong(thisQ, msg); },
        get wrongs() { return thisQ.wrongs; }
      };
      cfg.question(el, ctx);
      // 답 칸이 있는 쪽(오른쪽) 아래에 피드백과 '다음' 버튼을 둠: 확인 버튼 바로 밑, 늘 같은 자리
      const col = el.querySelector('.th-answer-col');
      if (col) col.appendChild(bottom);
    }

    function feedback(text, kind) {
      const fb = $('.th-feedback');
      fb.innerHTML = text;
      fb.className = 'th-feedback is-' + kind;
    }

    function onCorrect(thisQ, specific) {
      if (thisQ.done || thisQ !== q) return;
      thisQ.done = true;
      clearTimers();
      const first = thisQ.wrongs === 0;
      let text = randomPraise();
      if (!first) text = '다시 해서 맞혔어! ' + text;
      else if (specific && session.firstTries % 2 === 1) text = specific + ' ' + text;
      if (first) session.firstTries += 1;

      // 단계 조절
      let levelMsg = '';
      const s = loadSettings();
      const isLast = session.index >= session.total - 1;
      if (first) {
        session.streak += 1;
        if (s.autoUp && !isLast && session.streak >= 3 && session.level < levels.length) {
          session.level += 1; session.streak = 0;
          levelMsg = '이제 조금 더 어려운 문제야!';
        }
      } else {
        session.streak = 0;
        if (s.autoDown && !isLast && thisQ.wrongs >= 2 && session.level > 1) {
          session.level -= 1;
          levelMsg = '다음은 조금 쉬운 문제로 연습해 보자.';
        }
      }

      feedback(`🐸 ${text}` + (levelMsg ? `<small>${levelMsg}</small>` : ''), 'good');
      speak(text);
      logResult(first);
      if (thisQ.review) finishReview(thisQ.review.data, first);

      session.index += 1;
      paintPads(true);
      // 확인 버튼 자리에 '다음' 버튼이 나옴 (버튼 위치가 바뀌지 않게)
      app.querySelectorAll('.th-q .th-check').forEach(b => { b.style.display = 'none'; });
      $('.th-next').classList.add('is-shown');
    }

    function onWrong(thisQ, msg) {
      if (thisQ.done || thisQ !== q) return thisQ.wrongs;
      thisQ.wrongs += 1;
      const text = msg || (thisQ.wrongs === 1
        ? '괜찮아, 다시 해 보자 🐸'
        : '같이 보자! 그림을 보고 천천히 다시 해 보자 🐸');
      feedback(text, 'retry');
      if (thisQ.wrongs === 1 && !thisQ.review) addReview(thisQ.data);
      return thisQ.wrongs;
    }

    function showEnd() {
      clearTimers();
      const stickers = store.get('stickers', 0) + 1;
      store.set('stickers', stickers);
      $('.th-end-text').innerHTML =
        `${session.total}문제를 끝까지 풀었어!<br>바로 맞힌 문제: <b>${session.firstTries}개</b><br>개구리 스티커를 하나 받았어. 지금까지 <b>${stickers}개</b>!`;
      const row = $('.th-sticker-row');
      const showN = Math.min(stickers, 20);
      row.textContent = '🐸'.repeat(showN) + (stickers > showN ? ` +${stickers - showN}` : '');
      show('end');
      speak('끝까지 잘했어! 대단해!');
    }

    /* ----- 어른 설정 ----- */
    const overlay = $('.th-overlay');
    function seg(label, choices, current, onPick, note) {
      const row = h('div', 'th-set-row');
      row.appendChild(h('div', 'th-set-label', label));
      const g = h('div', 'th-seg');
      choices.forEach(c => {
        const b = h('button', 'th-seg-btn' + (c.value === current ? ' is-on' : ''), c.label);
        b.type = 'button';
        b.addEventListener('click', () => {
          g.querySelectorAll('.th-seg-btn').forEach(x => x.classList.remove('is-on'));
          b.classList.add('is-on');
          onPick(c.value);
        });
        g.appendChild(b);
      });
      row.appendChild(g);
      if (note) row.appendChild(h('div', 'th-set-note', note));
      return row;
    }
    function paintSettings() {
      const body = $('.th-panel-body');
      body.innerHTML = '';
      const s = loadSettings();
      const upd = (k, v) => { const x = loadSettings(); x[k] = v; saveSettings(x); paintSound(); };
      const onOff = [{ value: true, label: '켜기' }, { value: false, label: '끄기' }];

      body.appendChild(seg('시작 단계',
        levels.map((l, i) => ({ value: i + 1, label: `${i + 1}단계 · ${l.name}` })),
        getStartLevel(), v => store.set('level:' + id, v),
        levels.map((l, i) => `<b>${i + 1}단계</b> ${l.desc}`).join('<br>')));
      (cfg.options || []).forEach(o => {
        body.appendChild(seg(o.label, o.choices, getOpts()[o.key], v => {
          const cur = store.get('opt:' + id, {}); cur[o.key] = v; store.set('opt:' + id, cur);
        }, o.note));
      });
      body.appendChild(seg('한 번에 풀 문제 수', [5, 8, 10, 15].map(n => ({ value: n, label: n + '문제' })),
        s.count, v => upd('count', v)));
      body.appendChild(seg('처음에 짧은 설명 보기', onOff, s.showIntro, v => upd('showIntro', v)));
      body.appendChild(seg('힌트 기다리는 시간',
        [{ value: 0, label: '바로' }, { value: 3, label: '3초' }, { value: 5, label: '5초' }, { value: -1, label: '끔' }],
        s.hintDelay, v => upd('hintDelay', v),
        '2단계부터 힌트가 이 시간 뒤에 나타나요. 틀리면 바로 나와요.'));
      body.appendChild(seg('바로 3번 맞히면 단계 올리기', onOff, s.autoUp, v => upd('autoUp', v)));
      body.appendChild(seg('한 문제를 2번 틀리면 단계 낮추기', onOff, s.autoDown, v => upd('autoDown', v)));
      const koVoices = hasSpeech ? global.speechSynthesis.getVoices().filter(isKo) : [];
      if (koVoices.length > 1) {
        body.appendChild(seg('목소리 고르기',
          koVoices.map(v => ({ value: v.name, label: v.name.replace(/\s*\(.*\)$/, '') })),
          (pickVoice() || {}).name,
          v => { upd('voiceName', v); pickVoice(); const x = loadSettings(); if (x.sound) speak(randomPraise()); },
          '누르면 그 목소리로 칭찬을 들려줘요. 마음에 드는 목소리를 고르세요.'));
      }
      const sound = seg('칭찬 목소리', onOff, s.sound, v => upd('sound', v),
        hasSpeech ? (pickVoice() ? `목소리: ${koVoice.name} (${koVoice.lang})` : '이 기기에서 한국어 목소리를 찾지 못했어요. 외국어로 읽지 않도록 목소리는 꺼 둬요. 기기 설정의 음성(말하기) 메뉴에서 한국어 목소리를 받으면 나와요.') : '이 브라우저는 목소리를 지원하지 않아요.');
      const test = h('button', 'th-link-btn', '▶ 목소리 들어보기');
      test.type = 'button';
      test.addEventListener('click', () => { const x = loadSettings(); if (!x.sound) return; pickVoice(); speak(randomPraise()); });
      sound.appendChild(test);
      body.appendChild(sound);

      // 기록
      const rec = h('div', 'th-set-row');
      rec.appendChild(h('div', 'th-set-label', '최근 기록 (이 기기)'));
      const log = store.get('log:' + id, {});
      const days = Object.keys(log).sort().reverse().slice(0, 7);
      rec.appendChild(h('div', 'th-set-note', days.length
        ? days.map(d => `${d} · ${log[d].total}문제 중 바로 맞힘 ${log[d].first}개`).join('<br>')
        : '아직 기록이 없어요.'));
      const pending = store.get(rk, []).length;
      rec.appendChild(h('div', 'th-set-note', `복습 대기 문제: ${pending}개`));
      const wipe = h('button', 'th-link-btn', '기록 지우기');
      wipe.type = 'button';
      let armed = false;
      wipe.addEventListener('click', () => {
        if (!armed) { armed = true; wipe.textContent = '한 번 더 누르면 지워져요'; return; }
        store.remove('log:' + id); store.remove(rk);
        paintSettings();
      });
      rec.appendChild(wipe);
      body.appendChild(rec);
    }
    $('.th-open-settings').addEventListener('click', () => { paintSettings(); overlay.hidden = false; });
    $('.th-close-settings').addEventListener('click', () => { overlay.hidden = true; paintStart(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.hidden = true; paintStart(); } });

    /* ----- 버튼 연결 ----- */
    $('.th-go').addEventListener('click', () => { speak('시작!'); startSession(); });
    $('.th-intro-go').addEventListener('click', () => { show('play'); loadQuestion(); });
    $('.th-next').addEventListener('click', () => loadQuestion());
    $('.th-again').addEventListener('click', () => { paintStart(); startSession(); });

    paintStart();
    show('start');
  }

  global.Tamheom = { activity, slot, fraction, keypad, speak, randInt, pick, h, store, josa, fracHTML, fracJosa };
})(window);
