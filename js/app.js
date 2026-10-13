/* Interfaz del juego: tablero SVG, paneles y diálogos. Las reglas están en engine.js. */
(function () {
  'use strict';

  const { WHITE, BLACK, BAR, OFF } = BG;
  const STORAGE_KEY = 'backgammon-para-dos/v1';
  const COLOR_NAME = ['blancas', 'negras'];
  const KIND_NAME = { 1: 'sencilla', 2: 'gammon', 3: 'backgammon' };
  const KIND_WITH_ARTICLE = { 1: 'una sencilla', 2: 'un gammon', 3: 'un backgammon' };
  const NS = 'http://www.w3.org/2000/svg';
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ------------------------------------------- Geometría (unidades del viewBox 950 × 700)

  const W = 950, H = 700;
  const TOP = 26, BOTTOM = 674, MID = 350;
  const POINT_W = 60, POINT_H = 262;
  const R = 25.5, STEP = 51;
  const LEFT_X = 80, BAR_X = 440, BAR_W = 70, RIGHT_X = 510, TRAY_X = 870;
  const BAR_CX = BAR_X + BAR_W / 2;
  const TRAY_CX = TRAY_X + 40;
  const TRAY_GAP = 24; // separación de las bandejas respecto al centro
  const RAIL_CX = LEFT_X / 2;
  const SLAB_H = 16, SLAB_PITCH = 18;
  // Cada jugador tira en la mitad que le queda a su derecha:
  // blancas (abajo) en la mitad derecha, negras (arriba) en la izquierda.
  const ROLL_CX = [RIGHT_X + 3 * POINT_W, LEFT_X + 3 * POINT_W];

  function pointX(abs) {
    if (abs <= 6) return RIGHT_X + (6 - abs) * POINT_W;
    if (abs <= 12) return LEFT_X + (12 - abs) * POINT_W;
    if (abs <= 18) return LEFT_X + (abs - 13) * POINT_W;
    return RIGHT_X + (abs - 19) * POINT_W;
  }
  const isTop = (abs) => abs >= 13;

  /** Centro de la ficha i (0 = la del borde) de una pila de n fichas en key (1..24, 'bar' u 'off'). */
  function checkerXY(p, key, i, n) {
    if (key === 'bar') {
      const room = MID - 60 - (TOP + R);
      const step = n > 1 ? Math.min(STEP, room / (n - 1)) : STEP;
      // Las fichas en la barra esperan junto a la mitad por la que van a entrar.
      return p === WHITE ? { x: BAR_CX, y: MID - 60 - i * step } : { x: BAR_CX, y: MID + 60 + i * step };
    }
    if (key === 'off') {
      const d = SLAB_H / 2 + 3 + i * SLAB_PITCH;
      return p === WHITE ? { x: TRAY_CX, y: BOTTOM - d } : { x: TRAY_CX, y: TOP + d };
    }
    const step = n > 5 ? (POINT_H - 2 * R) / (n - 1) : STEP;
    const d = R + i * step;
    return { x: pointX(key) + POINT_W / 2, y: isTop(key) ? TOP + d : BOTTOM - d };
  }

  function countAt(pos, p, key) {
    if (key === 'bar') return pos.bar[p];
    if (key === 'off') return pos.off[p];
    const v = pos.points[key] * (p === WHITE ? 1 : -1);
    return v > 0 ? v : 0;
  }

  const relToKey = (p, rel) => (rel === BAR ? 'bar' : rel === OFF ? 'off' : BG.toAbs(p, rel));
  const keyToRel = (p, key) => (key === 'bar' ? BAR : key === 'off' ? OFF : BG.toAbs(p, key));

  // -------------------------------------------------------------- Estado

  let match = null;
  const ui = {
    selected: null,   // casilla de origen seleccionada (1..24 o 'bar')
    rolling: null,    // { faces: [a, b] } mientras se anima la tirada
    resignMenu: false,
    fx: null,         // animaciones pendientes tras el próximo render
    primary: null,    // acción de la tecla Espacio / Intro
    logLen: -1,
  };

  const $ = (id) => document.getElementById(id);
  const svg = $('board');

  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const pts = (n) => (n === 1 ? '1 punto' : `${n} puntos`);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  // ------------------------------------------------------------- Persistencia

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(match.s));
    } catch (e) {
      // Sin almacenamiento disponible: la partida dura lo que dure la página.
    }
  }

  function restore(state) {
    if (!state || state.v !== 1 || !state.pos || !Array.isArray(state.pos.points) || state.pos.points.length !== 25) {
      return null;
    }
    return new BG.Match(state);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? restore(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }

  function commit() {
    save();
    render();
  }

  // ------------------------------------------------------------- Jugadas

  function movableSources() {
    const s = match.s;
    return new Set(match.legalMoves().map((m) => relToKey(s.turn, m.from)));
  }

  /**
   * Destinos alcanzables desde una casilla, encadenando dados con la misma ficha.
   * Devuelve Map(destino -> lista de movimientos). Prefiere el camino más corto y,
   * a igualdad, el que no golpea por el camino.
   */
  function destinationsFrom(fromKey) {
    const s = match.s;
    const p = s.turn;
    const best = new Map();
    const hitsOnTheWay = (path) => path.slice(0, -1).filter((m) => m.hit).length;
    const better = (a, b) => !b || a.length < b.length || (a.length === b.length && hitsOnTheWay(a) < hitsOnTheWay(b));

    (function walk(pos, remaining, needed, at, path) {
      const moves = BG.legalMoves(pos, p, remaining, needed, s.forcedDie)
        .filter((m) => m.from === at)
        .sort((a, b) => a.die - b.die);
      for (const m of moves) {
        const next = path.concat(m);
        const key = relToKey(p, m.to);
        if (better(next, best.get(key))) best.set(key, next);
        if (m.to !== OFF && needed > 1) {
          walk(BG.applyMove(pos, p, m), BG.removeDie(remaining, m.die), needed - 1, m.to, next);
        }
      }
    })(s.pos, s.remaining, s.maxMoves - s.played.length, keyToRel(p, fromKey), []);

    return best;
  }

  function autoSelect() {
    ui.selected = null;
    if (match.s.phase !== 'moving') return;
    const sources = movableSources();
    if (sources.size === 1) ui.selected = sources.values().next().value;
  }

  function playPath(fromKey, toKey, path) {
    const s = match.s;
    const p = s.turn;
    const nFrom = countAt(s.pos, p, fromKey);
    const fromXY = checkerXY(p, fromKey, nFrom - 1, nFrom);
    const hits = [];
    for (const m of path) {
      const done = match.play(m.from, m.to, m.die);
      if (!done) break;
      if (done.hit) hits.push(relToKey(p, done.to));
    }
    const nTo = countAt(s.pos, p, toKey);
    const fx = [{ p, from: fromXY, to: checkerXY(p, toKey, nTo - 1, nTo), id: `${p}:${toKey}:${nTo - 1}` }];
    const opp = 1 - p;
    const nBar = s.pos.bar[opp];
    hits.forEach((key, j) => {
      const idx = nBar - hits.length + j;
      fx.push({ p: opp, from: checkerXY(opp, key, 0, 1), to: checkerXY(opp, 'bar', idx, nBar), id: `${opp}:bar:${idx}` });
    });
    ui.fx = fx;
    autoSelect();
    commit();
  }

  function onBoardClick(ev) {
    const el = ev.target.closest('[data-key]');
    if (!el) return;
    const raw = el.getAttribute('data-key');
    if (raw === 'roll') {
      doRoll();
      return;
    }
    const s = match.s;
    if (s.phase !== 'moving' || ui.rolling || ui.resignMenu) return;
    const key = raw === 'bar' || raw === 'off' ? raw : Number(raw);
    if (ui.selected != null) {
      const path = destinationsFrom(ui.selected).get(key);
      if (path) {
        playPath(ui.selected, key, path);
        return;
      }
    }
    ui.selected = movableSources().has(key) && key !== ui.selected ? key : null;
    render();
  }

  function doRoll() {
    if (ui.rolling) return;
    const phase = match.s.phase;
    if (phase !== 'opening' && phase !== 'preRoll') return;
    ui.resignMenu = false;
    const finish = () => {
      ui.rolling = null;
      if (match.s.phase === 'opening') match.rollOpening();
      else if (match.s.phase === 'preRoll') match.roll();
      autoSelect();
      commit();
    };
    if (reduceMotion) {
      finish();
      return;
    }
    const started = performance.now();
    ui.rolling = { faces: [BG.rollDie(), BG.rollDie()] };
    render();
    (function tick() {
      setTimeout(() => {
        if (performance.now() - started >= 450) {
          finish();
          return;
        }
        ui.rolling.faces = [BG.rollDie(), BG.rollDie()];
        render();
        tick();
      }, 75);
    })();
  }

  const actions = {
    roll: doRoll,
    double() { if (match.offerDouble()) commit(); },
    take() { if (match.acceptDouble()) commit(); },
    drop() { if (match.declineDouble()) commit(); },
    undo() {
      if (match.undo()) {
        autoSelect();
        commit();
      }
    },
    confirm() {
      if (match.confirm()) {
        ui.selected = null;
        commit();
      }
    },
    resignMenu() { ui.resignMenu = true; ui.selected = null; render(); },
    cancelResign() { ui.resignMenu = false; autoSelect(); render(); },
    resign1() { offerResign(1); },
    resign2() { offerResign(2); },
    resign3() { offerResign(3); },
    acceptResign() { if (match.acceptResign()) commit(); },
    rejectResign() {
      if (match.rejectResign()) {
        autoSelect();
        commit();
      }
    },
    next() {
      if (match.nextGame()) {
        ui.selected = null;
        commit();
      }
    },
    rematch() {
      const s = match.s;
      match = BG.Match.create({ names: s.names, matchLength: s.matchLength, jacoby: s.jacoby });
      ui.selected = null;
      commit();
    },
    newMatch() { openNewDialog(); },
  };

  function offerResign(level) {
    ui.resignMenu = false;
    if (match.offerResign(level)) commit();
  }

  // ------------------------------------------------------------- Tablero SVG

  const DEFS = `<defs>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6b4529"/><stop offset=".45" stop-color="#4a2e1b"/><stop offset="1" stop-color="#5d3b23"/>
    </linearGradient>
    <linearGradient id="woodDark" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#352013"/><stop offset=".5" stop-color="#55361f"/><stop offset="1" stop-color="#352013"/>
    </linearGradient>
    <radialGradient id="felt" cx="50%" cy="50%" r="72%">
      <stop offset="0" stop-color="#2d644c"/><stop offset="1" stop-color="#18402f"/>
    </radialGradient>
    <radialGradient id="ivory" cx="38%" cy="34%" r="70%">
      <stop offset="0" stop-color="#fffbf2"/><stop offset=".6" stop-color="#ebdfc4"/><stop offset="1" stop-color="#c9b58e"/>
    </radialGradient>
    <radialGradient id="ebony" cx="38%" cy="34%" r="70%">
      <stop offset="0" stop-color="#635a54"/><stop offset=".6" stop-color="#2b2623"/><stop offset="1" stop-color="#141110"/>
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#000" flood-opacity=".45"/>
    </filter>
  </defs>`;

  const PIPS = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  };
  const side = (p) => (p === WHITE ? 'w' : 'b');

  function dieSVG(cx, cy, size, value, p, used) {
    const h = size / 2;
    const o = size * 0.26;
    let out = `<g class="die die-${side(p)}${used ? ' is-used' : ''}">` +
      `<rect x="${cx - h}" y="${cy - h}" width="${size}" height="${size}" rx="${size * 0.18}"/>`;
    for (const [dx, dy] of PIPS[value]) {
      out += `<circle class="pip" cx="${cx + dx * o}" cy="${cy + dy * o}" r="${size * 0.09}"/>`;
    }
    return out + '</g>';
  }

  function diceRow(cx, values, p, used) {
    const size = values.length > 2 ? 44 : 54;
    const gap = values.length > 2 ? 8 : 12;
    let x = cx - (values.length * size + (values.length - 1) * gap) / 2 + size / 2;
    return values.map((v, i) => {
      const out = dieSVG(x, MID, size, v, p, used[i]);
      x += size + gap;
      return out;
    }).join('');
  }

  function checkerSVG(p, x, y, id) {
    return `<g class="ck ck-${side(p)}" data-ck="${id}">` +
      `<circle class="ck-body" cx="${x}" cy="${y}" r="${R}"/>` +
      `<circle class="ck-ring" cx="${x}" cy="${y}" r="${R * 0.62}"/></g>`;
  }

  function cubeSVG(cx, cy, value, cls) {
    return `<g class="cube ${cls || ''}"><rect x="${cx - 22}" y="${cy - 22}" width="44" height="44" rx="7"/>` +
      `<text x="${cx}" y="${cy + 1}">${value}</text></g>`;
  }

  function rollTarget(cx, label, sub) {
    return `<g class="roll-target" data-key="roll">` +
      `<rect x="${cx - 100}" y="${MID - 34}" width="200" height="68" rx="12"/>` +
      `<text x="${cx}" y="${MID - 9}">${esc(label)}</text>` +
      `<text class="roll-sub" x="${cx}" y="${MID + 15}">${esc(sub)}</text></g>`;
  }

  function trayRect(p, cls) {
    const y = p === WHITE ? MID + TRAY_GAP : TOP;
    return `<rect class="${cls}" x="${TRAY_X + 8}" y="${y}" width="64" height="${MID - TRAY_GAP - TOP}" rx="6"/>`;
  }

  function trianglePath(abs, inset) {
    const x = pointX(abs);
    const base = isTop(abs) ? TOP : BOTTOM;
    const tip = isTop(abs) ? TOP + POINT_H : BOTTOM - POINT_H;
    return `M${x + inset} ${base}L${x + POINT_W - inset} ${base}L${x + POINT_W / 2} ${tip}Z`;
  }

  function renderBoard() {
    const s = match.s;
    const pos = s.pos;
    const viewer = s.turn == null ? WHITE : s.turn;
    const interactive = s.phase === 'moving' && !ui.rolling && !ui.resignMenu;
    const sources = interactive ? movableSources() : new Set();
    const dests = interactive && ui.selected != null ? destinationsFrom(ui.selected) : new Map();
    const out = [DEFS];

    // Caja, fieltro, barra y bandejas
    out.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="url(#wood)"/>`);
    out.push(`<rect class="felt" x="${LEFT_X}" y="${TOP}" width="${6 * POINT_W}" height="${BOTTOM - TOP}"/>`);
    out.push(`<rect class="felt" x="${RIGHT_X}" y="${TOP}" width="${6 * POINT_W}" height="${BOTTOM - TOP}"/>`);
    out.push(`<rect class="bar" x="${BAR_X}" y="0" width="${BAR_W}" height="${H}"/>`);
    out.push(`<line class="hinge" x1="${BAR_CX}" y1="10" x2="${BAR_CX}" y2="${H - 10}"/>`);
    out.push(trayRect(BLACK, 'tray'), trayRect(WHITE, 'tray'));

    // Puntas y numeración (desde el punto de vista de quien tiene el turno)
    for (let a = 1; a <= 24; a++) {
      out.push(`<path class="${a % 2 ? 'pt-dark' : 'pt-light'}" d="${trianglePath(a, 3)}"/>`);
      const ly = isTop(a) ? TOP / 2 : BOTTOM + (H - BOTTOM) / 2;
      out.push(`<text class="pt-num" x="${pointX(a) + POINT_W / 2}" y="${ly}">${viewer === WHITE ? a : 25 - a}</text>`);
    }
    for (const key of dests.keys()) {
      out.push(key === 'off' ? trayRect(s.turn, 'dest-tray') : `<path class="dest-tri" d="${trianglePath(key, 3)}"/>`);
    }

    // Cubo
    if (s.matchLength !== 1) {
      if (s.phase === 'doubleOffered') {
        out.push(cubeSVG(ROLL_CX[s.turn], MID, s.cube.value * 2, 'is-offer'));
      } else {
        const y = s.cube.owner === null ? MID : s.cube.owner === WHITE ? BOTTOM - 40 : TOP + 40;
        out.push(cubeSVG(RAIL_CX, y, s.cube.value === 1 ? 64 : s.cube.value, s.isCrawford ? 'is-off' : ''));
        if (s.isCrawford) out.push(`<text class="rail-label" x="${RAIL_CX}" y="${MID + 42}">CRAWFORD</text>`);
      }
    }

    // Fichas
    const checkers = [];
    const counts = [];
    const stack = (p, key, n) => {
      for (let i = 0; i < n; i++) {
        const { x, y } = checkerXY(p, key, i, n);
        checkers.push(checkerSVG(p, x, y, `${p}:${key}:${i}`));
      }
      if (n > 5) {
        const { x, y } = checkerXY(p, key, n - 1, n);
        counts.push(`<text class="ck-count ck-count-${side(p)}" x="${x}" y="${y + 1}">${n}</text>`);
      }
    };
    for (let a = 1; a <= 24; a++) {
      const v = pos.points[a];
      if (v) stack(v > 0 ? WHITE : BLACK, a, Math.abs(v));
    }
    for (const p of [WHITE, BLACK]) {
      stack(p, 'bar', pos.bar[p]);
      for (let i = 0; i < pos.off[p]; i++) {
        const { x, y } = checkerXY(p, 'off', i, pos.off[p]);
        checkers.push(`<rect class="slab-${side(p)}" data-ck="${p}:off:${i}" x="${x - 25}" y="${y - SLAB_H / 2}" width="50" height="${SLAB_H}" rx="3"/>`);
      }
    }
    out.push(`<g filter="url(#shadow)">${checkers.join('')}</g>`, counts.join(''));

    // Pistas: fichas que se pueden mover, ficha elegida y destinos posibles
    const ring = (key, cls, extra) => {
      const n = countAt(pos, s.turn, key);
      if (!n) return '';
      const { x, y } = checkerXY(s.turn, key, n - 1, n);
      return `<circle class="${cls}" cx="${x}" cy="${y}" r="${R + extra}"/>`;
    };
    if (ui.selected == null) for (const key of sources) out.push(ring(key, 'hint-ring', 2.5));
    else out.push(ring(ui.selected, 'sel-ring', 3));
    for (const key of dests.keys()) {
      if (key === 'off') continue;
      const n = countAt(pos, s.turn, key);
      const { x, y } = checkerXY(s.turn, key, n, n + 1);
      out.push(`<circle class="dest-ghost" cx="${x}" cy="${y}" r="${R}"/>`);
    }

    // Dados
    out.push(renderDice(s));

    // Zonas que reciben los clics
    const active = new Set([...sources, ...dests.keys()]);
    const hit = (key, x, y, w, h) =>
      `<rect class="hit${active.has(key) ? ' is-active' : ''}" data-key="${key}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    for (let a = 1; a <= 24; a++) out.push(hit(a, pointX(a), isTop(a) ? TOP : MID, POINT_W, MID - TOP));
    out.push(hit('bar', BAR_X, 0, BAR_W, H), hit('off', TRAY_X, 0, W - TRAY_X, H));

    // Botones de tirada sobre el tablero
    if (!ui.rolling) {
      if (s.phase === 'opening' && !(s.opening && s.opening.tie)) {
        out.push(rollTarget(ROLL_CX[WHITE], 'Tirada inicial', s.names[WHITE]));
        out.push(rollTarget(ROLL_CX[BLACK], 'Tirada inicial', s.names[BLACK]));
      } else if (s.phase === 'preRoll' && !ui.resignMenu) {
        out.push(rollTarget(ROLL_CX[s.turn], 'Tirar dados', s.names[s.turn]));
      }
    }

    out.push(renderBanner(s), '<g id="fx"></g>');
    svg.innerHTML = out.join('');
    svg.classList.toggle('is-busy', !!ui.rolling);
  }

  function renderDice(s) {
    if (ui.rolling) {
      const [a, b] = ui.rolling.faces;
      if (s.phase === 'opening') {
        return dieSVG(ROLL_CX[WHITE], MID, 54, a, WHITE, false) + dieSVG(ROLL_CX[BLACK], MID, 54, b, BLACK, false);
      }
      return diceRow(ROLL_CX[s.turn], [a, b], s.turn, [false, false]);
    }
    if (s.phase === 'opening' && s.opening && s.opening.tie) {
      const [a, b] = s.opening.dice;
      return `<g class="roll-target" data-key="roll">` +
        dieSVG(ROLL_CX[WHITE], MID, 54, a, WHITE, false) + dieSVG(ROLL_CX[BLACK], MID, 54, b, BLACK, false) + '</g>';
    }
    if (!s.dice || (s.phase !== 'moving' && s.phase !== 'resignOffered')) return '';
    const all = BG.diceToMoves(s.dice);
    let used;
    if (match.isTurnComplete()) used = all.map(() => true);
    else if (s.dice[0] === s.dice[1]) used = all.map((_, i) => i < all.length - s.remaining.length);
    else used = all.map((d) => !s.remaining.includes(d));
    return diceRow(ROLL_CX[s.turn], all, s.turn, used);
  }

  function renderBanner(s) {
    const r = s.result;
    if (!r || (s.phase !== 'gameOver' && s.phase !== 'matchOver')) return '';
    const winner = s.names[r.winner];
    const title = s.phase === 'matchOver' ? `${winner} gana la partida` : `Gana ${winner}`;
    let sub;
    if (s.phase === 'matchOver') sub = `Marcador final ${s.score[WHITE]} – ${s.score[BLACK]}`;
    else if (r.reason === 'drop') sub = `Doble rechazado · ${pts(r.points)}`;
    else if (r.reason === 'resign') sub = `Abandono · ${pts(r.points)}`;
    else sub = `${cap(KIND_NAME[r.kind])} · ${pts(r.points)}`;
    const cx = (LEFT_X + TRAY_X) / 2;
    return `<g class="banner"><rect x="${LEFT_X + 40}" y="${MID - 60}" width="${TRAY_X - LEFT_X - 80}" height="120" rx="12"/>` +
      `<text class="b-title" x="${cx}" y="${MID - 16}">${esc(title)}</text>` +
      `<text class="b-sub" x="${cx}" y="${MID + 28}">${esc(sub)}</text></g>`;
  }

  /** Vuelo de las fichas que se acaban de mover, desde su casilla de origen. */
  function runFx() {
    const list = ui.fx;
    ui.fx = null;
    if (!list || reduceMotion) return;
    const layer = svg.querySelector('#fx');
    if (!layer || typeof layer.animate !== 'function') return;
    for (const f of list) {
      const real = svg.querySelector(`[data-ck="${f.id}"]`);
      const ghost = document.createElementNS(NS, 'g');
      ghost.setAttribute('class', `ck ck-${side(f.p)}`);
      ghost.setAttribute('filter', 'url(#shadow)');
      ghost.innerHTML = `<circle class="ck-body" cx="${f.to.x}" cy="${f.to.y}" r="${R}"/>` +
        `<circle class="ck-ring" cx="${f.to.x}" cy="${f.to.y}" r="${R * 0.62}"/>`;
      layer.appendChild(ghost);
      if (real) real.style.visibility = 'hidden';
      const anim = ghost.animate(
        [
          { transform: `translate(${f.from.x - f.to.x}px, ${f.from.y - f.to.y}px)` },
          { transform: 'translate(0px, 0px)' },
        ],
        { duration: 260, easing: 'cubic-bezier(.2, .7, .3, 1)' }
      );
      const done = () => {
        ghost.remove();
        if (real) real.style.visibility = '';
      };
      anim.onfinish = done;
      anim.oncancel = done;
    }
  }

  // ------------------------------------------------------------- Paneles

  function actorOf(s) {
    if (s.phase === 'doubleOffered') return 1 - s.turn;
    if (s.phase === 'resignOffered') return 1 - s.resign.by;
    if (s.phase === 'preRoll' || s.phase === 'moving') return s.turn;
    return null;
  }

  function renderSide() {
    const s = match.s;
    const actor = actorOf(s);
    for (const p of [WHITE, BLACK]) {
      $(`pname-${p}`).textContent = s.names[p];
      $(`pscore-${p}`).textContent = s.score[p];
      $(`pscoreof-${p}`).textContent = s.matchLength > 0 ? `/${s.matchLength}` : ' pts';
      $(`ppips-${p}`).textContent = BG.pipCount(s.pos, p);
      $(`pbar-${p}`).textContent = s.pos.bar[p];
      $(`poff-${p}`).textContent = s.pos.off[p];
      const card = $(`pcard-${p}`);
      card.classList.toggle('is-turn', actor === p);
      card.querySelector('.turn-pill').textContent = actor === p && actor !== s.turn ? 'Decide' : 'Juega';
    }
    const meta = [s.matchLength > 0 ? `Partida a ${pts(s.matchLength)}` : 'Sin límite', `Juego ${s.gameNo}`];
    if (s.isCrawford) meta.push('Crawford');
    if (s.jacoby) meta.push('Jacoby');
    $('matchMeta').textContent = meta.join(' · ');

    let cube;
    if (s.matchLength === 1) cube = 'Partida a 1 punto: se juega sin cubo.';
    else if (s.isCrawford) cube = 'Juego Crawford: se juega sin cubo.';
    else if (s.cube.owner === null) cube = s.cube.value === 1 ? 'Cubo en el centro.' : `Cubo en el centro, a ${s.cube.value}.`;
    else cube = `Cubo a ${s.cube.value}, en poder de ${s.names[s.cube.owner]}.`;
    $('cubeInfo').textContent = cube;
  }

  function resultSentence(s, r, nm) {
    if (r.reason === 'drop') return `${nm(1 - r.winner)} rechaza el doble y ${nm(r.winner)} gana ${pts(r.points)}.`;
    if (r.reason === 'resign') return `${nm(1 - r.winner)} abandona y ${nm(r.winner)} gana ${pts(r.points)}.`;
    const jacoby = s.jacoby && r.kind > 1 && r.cube === 1 ? ' La regla Jacoby lo deja en sencilla porque nadie dobló.' : '';
    return `${nm(r.winner)} gana ${KIND_WITH_ARTICLE[r.kind]} y suma ${pts(r.points)}.${jacoby}`;
  }

  function renderActions() {
    const s = match.s;
    const nm = (p) => `<strong>${esc(s.names[p])}</strong>`;
    const buttons = [];
    let html = '';

    const resignChoices = () => {
      html = `${nm(s.turn)}, ¿qué ofreces al abandonar? ${nm(1 - s.turn)} decidirá si acepta.`;
      for (const level of [1, 2, 3]) {
        buttons.push({ act: `resign${level}`, label: `${cap(KIND_NAME[level])} · ${pts(match.pointsFor(level))}` });
      }
      buttons.push({ act: 'cancelResign', label: 'Cancelar', variant: 'ghost' });
    };

    switch (s.phase) {
      case 'opening': {
        if (ui.rolling) html = 'Tirando…';
        else if (s.opening && s.opening.tie) html = `Empate a ${s.opening.dice[0]}. Hay que volver a tirar.`;
        else html = 'Cada jugador tira un dado. Empieza el número más alto y juega los dos dados.';
        buttons.push({ act: 'roll', label: 'Tirar para empezar', kbd: 'Espacio', variant: 'primary', disabled: !!ui.rolling });
        break;
      }
      case 'preRoll': {
        if (ui.resignMenu) { resignChoices(); break; }
        if (ui.rolling) html = `${nm(s.turn)} tira…`;
        else html = `Turno de ${nm(s.turn)} (${COLOR_NAME[s.turn]}). ${match.canDouble() ? 'Tira los dados o dobla.' : 'Tira los dados.'}`;
        buttons.push({ act: 'roll', label: 'Tirar dados', kbd: 'Espacio', variant: 'primary', disabled: !!ui.rolling });
        if (match.cubeInPlay) {
          let why = '';
          if (s.cube.owner !== null && s.cube.owner !== s.turn) why = `El cubo es de ${s.names[s.cube.owner]}.`;
          else if (s.cube.value >= BG.MAX_CUBE) why = 'El cubo ya está en 64.';
          buttons.push({ act: 'double', label: `Doblar a ${s.cube.value * 2}`, disabled: !match.canDouble() || !!ui.rolling, title: why });
        }
        buttons.push({ act: 'resignMenu', label: 'Abandonar', variant: 'ghost', disabled: !!ui.rolling });
        break;
      }
      case 'doubleOffered': {
        const v = s.cube.value;
        html = `${nm(s.turn)} dobla a ${v * 2}. ${nm(1 - s.turn)}, ¿aceptas? Si rechazas, pierdes ${pts(v)}.`;
        buttons.push({ act: 'take', label: `Aceptar a ${v * 2}`, variant: 'primary' });
        buttons.push({ act: 'drop', label: 'Rechazar' });
        break;
      }
      case 'moving': {
        if (ui.resignMenu) { resignChoices(); break; }
        const dice = `<span class="mono">${s.dice[0]}-${s.dice[1]}</span>`;
        if (s.maxMoves === 0) {
          html = `${nm(s.turn)} saca ${dice} y no puede mover.`;
        } else if (match.isTurnComplete()) {
          html = `Jugada: <span class="mono">${esc(BG.formatMoves(s.played))}</span>. Confirma para pasar el turno.`;
        } else {
          html = `${nm(s.turn)} juega ${dice}. `;
          const total = BG.diceToMoves(s.dice).length;
          if (s.forcedDie) html += `Solo se puede jugar un dado y tiene que ser el ${s.forcedDie}. `;
          else if (s.maxMoves < total) html += `Solo se pueden jugar ${s.maxMoves} de los ${total} movimientos. `;
          if (s.pos.bar[s.turn] > 0) html += 'Primero hay que entrar desde la barra.';
          else html += ui.selected != null ? 'Elige una punta marcada.' : 'Elige una ficha.';
        }
        buttons.push({ act: 'undo', label: 'Deshacer', disabled: s.played.length === 0 });
        buttons.push({
          act: 'confirm', label: s.maxMoves === 0 ? 'Pasar turno' : 'Confirmar', kbd: 'Intro',
          variant: 'primary', disabled: !match.isTurnComplete(),
        });
        buttons.push({ act: 'resignMenu', label: 'Abandonar', variant: 'ghost' });
        break;
      }
      case 'resignOffered': {
        const r = s.resign;
        html = `${nm(r.by)} abandona y ofrece ${KIND_WITH_ARTICLE[r.level]} (${pts(match.pointsFor(r.level))}). ${nm(1 - r.by)}, ¿aceptas?`;
        buttons.push({ act: 'acceptResign', label: 'Aceptar', variant: 'primary' });
        buttons.push({ act: 'rejectResign', label: 'Rechazar y seguir' });
        break;
      }
      case 'gameOver': {
        html = `${resultSentence(s, s.result, nm)} Marcador: ${esc(s.names[WHITE])} ${s.score[WHITE]}, ${esc(s.names[BLACK])} ${s.score[BLACK]}.`;
        buttons.push({ act: 'next', label: 'Siguiente juego', kbd: 'Intro', variant: 'primary' });
        break;
      }
      case 'matchOver': {
        const w = s.result.winner;
        html = `${resultSentence(s, s.result, nm)} ${nm(w)} gana la partida ${s.score[w]} a ${s.score[1 - w]}.`;
        buttons.push({ act: 'rematch', label: 'Revancha', variant: 'primary' });
        buttons.push({ act: 'newMatch', label: 'Nueva partida' });
        break;
      }
    }

    $('status').innerHTML = html;

    const box = $('actions');
    const focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.act : null;
    box.textContent = '';
    ui.primary = null;
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'btn' + (b.variant ? ` btn-${b.variant}` : '');
      el.dataset.act = b.act;
      el.disabled = !!b.disabled;
      if (b.title) el.title = b.title;
      el.textContent = b.label;
      if (b.kbd) {
        const k = document.createElement('kbd');
        k.textContent = b.kbd;
        el.appendChild(k);
      }
      box.appendChild(el);
      if (!ui.primary && b.variant === 'primary' && !b.disabled) ui.primary = b.act;
      if (focused === b.act && !b.disabled) el.focus({ preventScroll: true });
    }
  }

  function renderLog() {
    const s = match.s;
    const nm = (p) => `<strong>${esc(s.names[p])}</strong>`;
    const chip = (p) => `<span class="chip chip-sm ${p == null ? 'chip-none' : `chip-${side(p)}`}" aria-hidden="true"></span>`;
    const row = (p, body) => `<li>${chip(p)}<span>${body}</span></li>`;
    const ev = (text) => `<span class="event">${text}</span>`;
    const items = s.log.map((e) => {
      switch (e.k) {
        case 'open':
          return row(e.p, ev(`Salida: ${esc(s.names[WHITE])} saca ${e.dice[0]} y ${esc(s.names[BLACK])} saca ${e.dice[1]}. ` +
            (e.p == null ? 'Empate.' : `Empieza ${nm(e.p)}.`)));
        case 'move':
          return row(e.p, `<span class="dice">${e.dice[0]}-${e.dice[1]}</span> ` +
            `<span class="mv">${e.moves.length ? esc(BG.formatMoves(e.moves)) : 'no puede mover'}</span>`);
        case 'double': return row(e.p, ev(`${nm(e.p)} dobla a ${e.value}.`));
        case 'take': return row(e.p, ev(`${nm(e.p)} acepta. El cubo vale ${e.value}.`));
        case 'drop': return row(e.p, ev(`${nm(e.p)} rechaza el doble.`));
        case 'resign': return row(e.p, ev(`${nm(e.p)} abandona y ofrece ${KIND_WITH_ARTICLE[e.level]}.`));
        case 'resignReject': return row(e.p, ev(`${nm(e.p)} rechaza el abandono.`));
        case 'end': {
          const how = e.reason === 'normal' && e.kind > 1 ? ` con ${KIND_WITH_ARTICLE[e.kind]}` : '';
          return row(e.winner, ev(`${nm(e.winner)} gana ${pts(e.points)}${how}.`));
        }
        default: return '';
      }
    });
    $('log').innerHTML = items.length ? items.join('') : row(null, ev('Todavía no hay jugadas.'));
    if (s.log.length !== ui.logLen) {
      ui.logLen = s.log.length;
      const scroller = $('logScroll');
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  function render() {
    renderBoard();
    renderSide();
    renderActions();
    renderLog();
    runFx();
  }

  // ------------------------------------------------------------- Diálogos

  const dlgNew = $('dlgNew');
  const dlgRules = $('dlgRules');

  function syncNewForm() {
    const len = $('matchLength').value;
    const jacoby = $('jacoby');
    jacoby.disabled = len !== '0';
    if (jacoby.disabled) jacoby.checked = false;
    $('lengthHint').textContent =
      len === '0' ? 'Se suman los puntos de cada juego, sin final fijo.' :
      len === '1' ? 'Un solo juego. Sin cubo, porque no cambia nada.' :
      'Gana quien llegue antes a los puntos. Se aplica la regla Crawford.';
  }

  function openNewDialog() {
    const s = match.s;
    $('nameWhite').value = s.names[WHITE];
    $('nameBlack').value = s.names[BLACK];
    $('matchLength').value = String(s.matchLength);
    syncNewForm();
    $('jacoby').checked = s.jacoby;
    $('newWarn').hidden = s.phase === 'matchOver' || (s.log.length === 0 && s.score[0] + s.score[1] === 0);
    dlgNew.showModal();
  }

  function startFromForm(ev) {
    ev.preventDefault();
    const len = parseInt($('matchLength').value, 10);
    match = BG.Match.create({
      names: [$('nameWhite').value.trim() || 'Jugador 1', $('nameBlack').value.trim() || 'Jugador 2'],
      matchLength: len,
      jacoby: len === 0 && $('jacoby').checked,
    });
    ui.selected = null;
    ui.resignMenu = false;
    ui.logLen = -1;
    dlgNew.close();
    commit();
  }

  // ------------------------------------------------------------- Arranque

  let bound = false;

  function bindEvents() {
    if (bound) return;
    bound = true;
    svg.addEventListener('click', onBoardClick);
    $('actions').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (btn && !btn.disabled && actions[btn.dataset.act]) actions[btn.dataset.act]();
    });
    $('btnNew').addEventListener('click', openNewDialog);
    $('btnRules').addEventListener('click', () => dlgRules.showModal());
    $('btnCloseRules').addEventListener('click', () => dlgRules.close());
    $('btnCancelNew').addEventListener('click', () => dlgNew.close());
    $('formNew').addEventListener('submit', startFromForm);
    $('matchLength').addEventListener('change', syncNewForm);
    for (const dlg of [dlgNew, dlgRules]) {
      // Cerrar al pulsar fuera del diálogo.
      dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
    }
    document.addEventListener('keydown', (ev) => {
      if (document.querySelector('dialog[open]')) return;
      const t = ev.target;
      if (t && t.closest && t.closest('button, input, select, textarea, a')) return;
      if (ev.key === ' ' || ev.key === 'Enter') {
        if (ui.primary && actions[ui.primary]) {
          ev.preventDefault();
          actions[ui.primary]();
        }
      } else if (ev.key === 'Backspace' || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z')) {
        ev.preventDefault();
        actions.undo();
      } else if (ev.key === 'Escape' && ui.selected != null) {
        ui.selected = null;
        render();
      }
    });
  }

  function boot(data) {
    match = (data && data.state && restore(data.state)) || load();
    const firstVisit = !match;
    if (!match) match = BG.Match.create({});
    bindEvents();
    autoSelect();
    render();
    if (firstVisit) openNewDialog();
  }

  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') {
    try { hot.snapshot(() => ({ state: match ? match.s : null })); } catch (e) { /* opcional */ }
  }
  if (hot && typeof hot.ready === 'function') hot.ready(boot);
  else boot((hot && hot.data) || {});
})();
