/*
 * Motor de reglas de backgammon (estándar internacional). No usa el DOM, así que
 * funciona igual en el navegador que en Node.
 *
 * Coordenadas
 *  - points[1..24] usa la numeración de las blancas: valores > 0 son fichas
 *    blancas y < 0 fichas negras.
 *  - Los movimientos se expresan en numeración "relativa" del jugador que mueve:
 *    su casa es 1..6, la barra es 25 y fuera del tablero es 0. Siempre se avanza
 *    hacia números más bajos.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WHITE = 0;
  const BLACK = 1;
  const BAR = 25;
  const OFF = 0;
  const CHECKERS = 15;
  const MAX_CUBE = 64;

  const other = (p) => 1 - p;
  const sign = (p) => (p === WHITE ? 1 : -1);
  /** Casilla relativa del jugador -> absoluta (la conversión es simétrica). */
  const toAbs = (p, rel) => (p === WHITE ? rel : 25 - rel);

  // ---------------------------------------------------------------- Posición

  function emptyPosition() {
    return { points: new Array(25).fill(0), bar: [0, 0], off: [0, 0] };
  }

  function initialPosition() {
    const pos = emptyPosition();
    // Cada jugador, en su numeración: 2 en la 24, 5 en la 13, 3 en la 8 y 5 en la 6.
    for (const p of [WHITE, BLACK]) {
      for (const [rel, n] of [[24, 2], [13, 5], [8, 3], [6, 5]]) {
        pos.points[toAbs(p, rel)] = n * sign(p);
      }
    }
    return pos;
  }

  function clonePosition(pos) {
    return { points: pos.points.slice(), bar: pos.bar.slice(), off: pos.off.slice() };
  }

  function ownAt(pos, p, rel) {
    const v = pos.points[toAbs(p, rel)] * sign(p);
    return v > 0 ? v : 0;
  }

  function oppAt(pos, p, rel) {
    const v = pos.points[toAbs(p, rel)] * sign(p);
    return v < 0 ? -v : 0;
  }

  function pipCount(pos, p) {
    let pips = pos.bar[p] * BAR;
    for (let rel = 1; rel <= 24; rel++) pips += ownAt(pos, p, rel) * rel;
    return pips;
  }

  function allHome(pos, p) {
    if (pos.bar[p] > 0) return false;
    for (let rel = 7; rel <= 24; rel++) if (ownAt(pos, p, rel) > 0) return false;
    return true;
  }

  function highestPoint(pos, p) {
    for (let rel = 24; rel >= 1; rel--) if (ownAt(pos, p, rel) > 0) return rel;
    return 0;
  }

  // ------------------------------------------------------------- Movimientos

  /** Movimientos de una ficha con un dado, sin tener en cuenta el resto de la tirada. */
  function singleMoves(pos, p, die) {
    const moves = [];
    if (pos.bar[p] > 0) {
      // Con fichas en la barra solo se puede entrar.
      const to = BAR - die;
      const opp = oppAt(pos, p, to);
      if (opp < 2) moves.push({ from: BAR, to, die, hit: opp === 1 });
      return moves;
    }
    const bearing = allHome(pos, p);
    const highest = bearing ? highestPoint(pos, p) : 0;
    for (let from = 24; from >= 1; from--) {
      if (ownAt(pos, p, from) === 0) continue;
      const to = from - die;
      if (to >= 1) {
        const opp = oppAt(pos, p, to);
        if (opp < 2) moves.push({ from, to, die, hit: opp === 1 });
      } else if (bearing && (to === 0 || from === highest)) {
        // Se saca con el número exacto, o con uno mayor desde la punta más alta.
        moves.push({ from, to: OFF, die, hit: false });
      }
    }
    return moves;
  }

  function applyMove(pos, p, m) {
    const next = clonePosition(pos);
    const s = sign(p);
    if (m.from === BAR) next.bar[p]--;
    else next.points[toAbs(p, m.from)] -= s;
    if (m.to === OFF) {
      next.off[p]++;
    } else {
      const a = toAbs(p, m.to);
      if (next.points[a] === -s) {
        next.points[a] = 0;
        next.bar[other(p)]++;
      }
      next.points[a] += s;
    }
    return next;
  }

  function diceToMoves(dice) {
    const [a, b] = dice;
    return a === b ? [a, a, a, a] : [a, b];
  }

  function removeDie(remaining, die) {
    const i = remaining.indexOf(die);
    const rest = remaining.slice();
    if (i >= 0) rest.splice(i, 1);
    return rest;
  }

  const distinct = (arr) => Array.from(new Set(arr));

  function positionKey(pos, remaining) {
    return pos.points.join(',') + '|' + pos.bar.join(',') + '|' + pos.off.join(',') + '|' +
      remaining.slice().sort().join('');
  }

  /** Número máximo de dados que se pueden jugar desde esta posición. */
  function maxPlayable(pos, p, remaining, memo) {
    if (remaining.length === 0) return 0;
    memo = memo || new Map();
    const key = positionKey(pos, remaining);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let best = 0;
    search:
    for (const d of distinct(remaining)) {
      const rest = removeDie(remaining, d);
      for (const m of singleMoves(pos, p, d)) {
        const n = 1 + maxPlayable(applyMove(pos, p, m), p, rest, memo);
        if (n > best) {
          best = n;
          if (best === remaining.length) break search;
        }
      }
    }
    memo.set(key, best);
    return best;
  }

  /**
   * Analiza la tirada al empezar el turno:
   *  - maxMoves: cuántos dados hay que jugar (hay que usar todos los posibles).
   *  - forcedDie: si solo se puede jugar uno de dos dados distintos, debe ser el
   *    mayor cuando sea posible; si no, el menor.
   */
  function analyzeTurn(pos, p, dice) {
    const remaining = diceToMoves(dice);
    const maxMoves = maxPlayable(pos, p, remaining);
    let forcedDie = null;
    if (maxMoves === 1 && dice[0] !== dice[1]) {
      const hi = Math.max(dice[0], dice[1]);
      const lo = Math.min(dice[0], dice[1]);
      forcedDie = singleMoves(pos, p, hi).length > 0 ? hi : lo;
    }
    return { maxMoves, forcedDie };
  }

  /** Movimientos legales en este momento del turno (needed = dados que faltan por jugar). */
  function legalMoves(pos, p, remaining, needed, forcedDie) {
    if (needed <= 0) return [];
    const memo = new Map();
    const result = [];
    for (const d of distinct(remaining)) {
      if (forcedDie != null && d !== forcedDie) continue;
      const rest = removeDie(remaining, d);
      for (const m of singleMoves(pos, p, d)) {
        if (1 + maxPlayable(applyMove(pos, p, m), p, rest, memo) >= needed) result.push(m);
      }
    }
    return result;
  }

  /** 1 = sencilla, 2 = gammon, 3 = backgammon. */
  function resultKind(pos, winner) {
    const loser = other(winner);
    if (pos.off[loser] > 0) return 1;
    if (pos.bar[loser] > 0) return 3;
    // La casa del ganador son las casillas 19..24 del perdedor.
    for (let rel = 19; rel <= 24; rel++) if (ownAt(pos, loser, rel) > 0) return 3;
    return 2;
  }

  // ---------------------------------------------------------------- Notación

  const pointLabel = (rel) => (rel === BAR ? 'bar' : rel === OFF ? 'off' : String(rel));

  /** Notación estándar: "13/7 8/7", "24/18*\/14", "6/off(2)". */
  function formatMoves(moves) {
    const chains = [];
    for (const m of moves) {
      let chain = null;
      if (m.from !== BAR) {
        for (let i = chains.length - 1; i >= 0; i--) {
          const last = chains[i][chains[i].length - 1];
          if (last.pt === m.from) { chain = chains[i]; break; }
        }
      }
      if (chain) chain.push({ pt: m.to, hit: m.hit });
      else chains.push([{ pt: m.from, hit: false }, { pt: m.to, hit: m.hit }]);
    }
    chains.sort((a, b) => b[0].pt - a[0].pt);
    const parts = chains.map((chain) => {
      let text = pointLabel(chain[0].pt);
      chain.slice(1).forEach((step, i, rest) => {
        const isLast = i === rest.length - 1;
        if (isLast || step.hit) text += '/' + pointLabel(step.pt) + (step.hit ? '*' : '');
      });
      return text;
    });
    const counts = new Map();
    for (const t of parts) counts.set(t, (counts.get(t) || 0) + 1);
    return Array.from(counts, ([t, n]) => (n > 1 ? `${t}(${n})` : t)).join(' ');
  }

  // ------------------------------------------------------------------ Dados

  function rollDie() {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && c.getRandomValues) {
      const buf = new Uint8Array(1);
      do { c.getRandomValues(buf); } while (buf[0] >= 252); // 252 = 6 * 42, sin sesgo
      return (buf[0] % 6) + 1;
    }
    return Math.floor(Math.random() * 6) + 1;
  }

  // ---------------------------------------------------------------- Partida

  /**
   * Partida completa (match) entre dos jugadores en el mismo dispositivo.
   * Todo el estado vive en this.s, un objeto plano que se puede guardar en JSON.
   *
   * Fases: opening → (preRoll ⇄ doubleOffered) → moving → … → gameOver / matchOver.
   * resignOffered puede aparecer desde preRoll o moving.
   */
  class Match {
    constructor(state) {
      this.s = state;
      this._legal = null;
    }

    static create(opts) {
      opts = opts || {};
      const names = opts.names || [];
      const matchLength = Number.isInteger(opts.matchLength) && opts.matchLength >= 0 ? opts.matchLength : 5;
      const m = new Match({
        v: 1,
        names: [names[0] || 'Jugador 1', names[1] || 'Jugador 2'],
        matchLength, // 0 = sin límite (por dinero)
        jacoby: matchLength === 0 && !!opts.jacoby,
        score: [0, 0],
        crawfordUsed: false,
        isCrawford: false,
        gameNo: 0,
        games: [],
      });
      m._setupGame();
      return m;
    }

    _setupGame() {
      const s = this.s;
      const N = s.matchLength;
      s.gameNo += 1;
      // Regla Crawford: el juego siguiente a que alguien se quede a 1 punto se juega sin cubo.
      s.isCrawford = false;
      if (N > 1 && !s.crawfordUsed && (s.score[0] === N - 1 || s.score[1] === N - 1)) {
        s.isCrawford = true;
        s.crawfordUsed = true;
      }
      Object.assign(s, {
        pos: initialPosition(),
        phase: 'opening',
        turn: null,
        dice: null,
        opening: null,
        remaining: [],
        played: [],
        turnStart: null,
        maxMoves: 0,
        forcedDie: null,
        cube: { value: 1, owner: null },
        resign: null,
        log: [],
        result: null,
      });
      this._legal = null;
    }

    // --- Tiradas

    rollOpening(rng) {
      const s = this.s;
      if (s.phase !== 'opening') return false;
      rng = rng || rollDie;
      const w = rng();
      const b = rng();
      const tie = w === b;
      s.opening = { dice: [w, b], tie };
      s.log.push({ k: 'open', dice: [w, b], p: tie ? null : w > b ? WHITE : BLACK });
      if (tie) return true;
      s.turn = w > b ? WHITE : BLACK;
      this._startMoving([w, b]);
      return true;
    }

    roll(rng) {
      const s = this.s;
      if (s.phase !== 'preRoll') return false;
      rng = rng || rollDie;
      this._startMoving([rng(), rng()]);
      return true;
    }

    _startMoving(dice) {
      const s = this.s;
      s.dice = dice.slice().sort((a, b) => b - a);
      s.remaining = diceToMoves(s.dice);
      s.played = [];
      s.turnStart = clonePosition(s.pos);
      const info = analyzeTurn(s.pos, s.turn, s.dice);
      s.maxMoves = info.maxMoves;
      s.forcedDie = info.forcedDie;
      s.phase = 'moving';
      this._legal = null;
    }

    // --- Movimientos

    legalMoves() {
      const s = this.s;
      if (s.phase !== 'moving') return [];
      const key = s.turn + ':' + s.dice.join('') + ':' + s.played.map((m) => `${m.from}>${m.to}:${m.die}`).join(',');
      if (!this._legal || this._legal.key !== key) {
        this._legal = {
          key,
          moves: legalMoves(s.pos, s.turn, s.remaining, s.maxMoves - s.played.length, s.forcedDie),
        };
      }
      return this._legal.moves;
    }

    isTurnComplete() {
      return this.s.phase === 'moving' && this.s.played.length >= this.s.maxMoves;
    }

    play(from, to, die) {
      const s = this.s;
      const m = this.legalMoves().find((x) => x.from === from && x.to === to && (die == null || x.die === die));
      if (!m) return null;
      s.pos = applyMove(s.pos, s.turn, m);
      s.remaining = removeDie(s.remaining, m.die);
      s.played.push(m);
      return m;
    }

    undo() {
      const s = this.s;
      if (s.phase !== 'moving' || s.played.length === 0) return false;
      const played = s.played.slice(0, -1);
      let pos = clonePosition(s.turnStart);
      let remaining = diceToMoves(s.dice);
      for (const m of played) {
        pos = applyMove(pos, s.turn, m);
        remaining = removeDie(remaining, m.die);
      }
      Object.assign(s, { pos, remaining, played });
      return true;
    }

    confirm() {
      const s = this.s;
      if (!this.isTurnComplete()) return false;
      s.log.push({ k: 'move', p: s.turn, dice: s.dice.slice(), moves: s.played.slice() });
      if (s.pos.off[s.turn] === CHECKERS) {
        this._finish(s.turn, resultKind(s.pos, s.turn), 'normal');
        return true;
      }
      s.turn = other(s.turn);
      Object.assign(s, {
        phase: 'preRoll', dice: null, remaining: [], played: [], turnStart: null, maxMoves: 0, forcedDie: null,
      });
      this._legal = null;
      return true;
    }

    // --- Cubo de doblaje

    get cubeInPlay() {
      return this.s.matchLength !== 1 && !this.s.isCrawford;
    }

    canDouble() {
      const s = this.s;
      return s.phase === 'preRoll' && this.cubeInPlay && s.cube.value < MAX_CUBE &&
        (s.cube.owner === null || s.cube.owner === s.turn);
    }

    offerDouble() {
      const s = this.s;
      if (!this.canDouble()) return false;
      s.phase = 'doubleOffered';
      s.log.push({ k: 'double', p: s.turn, value: s.cube.value * 2 });
      return true;
    }

    acceptDouble() {
      const s = this.s;
      if (s.phase !== 'doubleOffered') return false;
      const taker = other(s.turn);
      s.cube = { value: s.cube.value * 2, owner: taker };
      s.log.push({ k: 'take', p: taker, value: s.cube.value });
      s.phase = 'preRoll';
      return true;
    }

    declineDouble() {
      const s = this.s;
      if (s.phase !== 'doubleOffered') return false;
      s.log.push({ k: 'drop', p: other(s.turn) });
      this._finish(s.turn, 1, 'drop');
      return true;
    }

    // --- Abandono

    canResign() {
      return this.s.phase === 'preRoll' || this.s.phase === 'moving';
    }

    offerResign(level) {
      const s = this.s;
      if (!this.canResign() || ![1, 2, 3].includes(level)) return false;
      s.resign = { by: s.turn, level, prevPhase: s.phase };
      s.phase = 'resignOffered';
      s.log.push({ k: 'resign', p: s.turn, level });
      return true;
    }

    acceptResign() {
      const s = this.s;
      if (s.phase !== 'resignOffered') return false;
      this._finish(other(s.resign.by), s.resign.level, 'resign');
      return true;
    }

    rejectResign() {
      const s = this.s;
      if (s.phase !== 'resignOffered') return false;
      s.log.push({ k: 'resignReject', p: other(s.resign.by) });
      s.phase = s.resign.prevPhase;
      s.resign = null;
      return true;
    }

    // --- Resultado

    /** Puntos de un juego según el cubo. Con la regla Jacoby, sin doblar solo cuenta la sencilla. */
    pointsFor(kind) {
      const s = this.s;
      const mult = s.jacoby && s.cube.value === 1 ? 1 : kind;
      return s.cube.value * mult;
    }

    _finish(winner, kind, reason) {
      const s = this.s;
      const points = this.pointsFor(kind);
      s.score[winner] += points;
      s.result = { winner, kind, points, reason, cube: s.cube.value };
      s.games.push(Object.assign({ gameNo: s.gameNo }, s.result));
      s.log.push(Object.assign({ k: 'end' }, s.result));
      s.resign = null;
      s.phase = s.matchLength > 0 && s.score[winner] >= s.matchLength ? 'matchOver' : 'gameOver';
      this._legal = null;
    }

    nextGame() {
      if (this.s.phase !== 'gameOver') return false;
      this._setupGame();
      return true;
    }
  }

  return {
    WHITE, BLACK, BAR, OFF, CHECKERS, MAX_CUBE,
    other, toAbs,
    emptyPosition, initialPosition, clonePosition,
    pipCount, allHome, singleMoves, applyMove,
    diceToMoves, removeDie, maxPlayable, analyzeTurn, legalMoves,
    resultKind, formatMoves, rollDie,
    Match,
  };
});
