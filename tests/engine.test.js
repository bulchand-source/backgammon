/* Pruebas del motor de reglas. Se ejecutan abriendo tests/index.html. */
(function () {
  'use strict';
  const { WHITE, BLACK, BAR, OFF } = BG;
  const results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
    }
  }
  function eq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg || 'valor'}: esperado ${b}, obtenido ${a}`);
  }
  function ok(cond, msg) {
    if (!cond) throw new Error(msg || 'condición falsa');
  }

  /** Posición a partir de casillas relativas de cada jugador: {w: {6: 5, bar: 1}, b: {...}} */
  function position(spec) {
    const pos = BG.emptyPosition();
    for (const [p, key] of [[WHITE, 'w'], [BLACK, 'b']]) {
      const side = spec[key] || {};
      for (const k of Object.keys(side)) {
        if (k === 'bar') pos.bar[p] = side[k];
        else if (k === 'off') pos.off[p] = side[k];
        else pos.points[BG.toAbs(p, Number(k))] += side[k] * (p === WHITE ? 1 : -1);
      }
    }
    return pos;
  }
  /** Las negras bloquean (2 fichas) las casillas indicadas en numeración de las blancas. */
  function blackBlocks(whiteRels, extra) {
    const b = Object.assign({}, extra);
    for (const r of whiteRels) b[25 - r] = 2;
    return b;
  }
  const sig = (moves) => moves.map((m) => `${m.from}>${m.to}:${m.die}`).sort();
  function legalFor(pos, p, dice) {
    const info = BG.analyzeTurn(pos, p, dice);
    return { info, moves: BG.legalMoves(pos, p, BG.diceToMoves(dice), info.maxMoves, info.forcedDie) };
  }

  // ------------------------------------------------------------ Posición

  test('Posición inicial: 15 fichas y 167 pips por bando', () => {
    const pos = BG.initialPosition();
    let w = 0, b = 0;
    for (let i = 1; i <= 24; i++) {
      if (pos.points[i] > 0) w += pos.points[i];
      else b -= pos.points[i];
    }
    eq([w, b], [15, 15], 'fichas');
    eq([BG.pipCount(pos, WHITE), BG.pipCount(pos, BLACK)], [167, 167], 'pips');
    eq([pos.points[24], pos.points[13], pos.points[8], pos.points[6]], [2, 5, 3, 5], 'blancas');
    eq([pos.points[1], pos.points[12], pos.points[17], pos.points[19]], [-2, -5, -3, -5], 'negras');
  });

  // --------------------------------------------------------- Movimientos

  test('Apertura 6-1: se juegan los dos dados e incluye 13/7 y 8/7', () => {
    const { info, moves } = legalFor(BG.initialPosition(), WHITE, [6, 1]);
    eq(info.maxMoves, 2, 'dados a jugar');
    const s = sig(moves);
    ok(s.includes('13>7:6'), 'falta 13/7');
    ok(s.includes('8>7:1'), 'falta 8/7');
    ok(s.includes('24>18:6'), 'falta 24/18');
    ok(!s.includes('13>12:1'), '13/12 está bloqueado por las 5 negras de su 13');
  });

  test('Dobles: se juegan cuatro movimientos', () => {
    eq(BG.analyzeTurn(BG.initialPosition(), WHITE, [3, 3]).maxMoves, 4);
  });

  test('Con fichas en la barra solo se puede entrar', () => {
    const pos = position({ w: { bar: 1, 6: 5, 8: 3 }, b: { 6: 5 } });
    const { moves } = legalFor(pos, WHITE, [6, 5]);
    ok(moves.length > 0, 'debería poder entrar');
    ok(moves.every((m) => m.from === BAR), 'hay movimientos que no salen de la barra');
  });

  test('Casa rival cerrada: no hay movimiento posible', () => {
    const pos = position({ w: { bar: 1, 6: 5 }, b: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 } });
    eq(BG.analyzeTurn(pos, WHITE, [6, 5]).maxMoves, 0);
  });

  test('Golpear una ficha solitaria la manda a la barra', () => {
    const pos = position({ w: { 24: 1 }, b: { 7: 1 } }); // la 7 de las negras es la 18 de las blancas
    const m = BG.singleMoves(pos, WHITE, 6).find((x) => x.from === 24);
    ok(m && m.hit, 'debería ser un golpe');
    const next = BG.applyMove(pos, WHITE, m);
    eq(next.bar[BLACK], 1, 'negras en la barra');
    eq(next.points[18], 1, 'blanca en la 18');
  });

  test('No se puede caer en una punta con dos fichas rivales', () => {
    const pos = position({ w: { 13: 1 }, b: blackBlocks([7]) });
    ok(!BG.singleMoves(pos, WHITE, 6).length, 'la 7 está bloqueada');
  });

  test('Hay que jugar los dos dados si es posible', () => {
    // A en 9, C en 8, B atrapada en 20. Negras bloquean 1, 4, 15 y 17. Tirada 5-3.
    const pos = position({ w: { 9: 1, 8: 1, 20: 1 }, b: blackBlocks([1, 4, 15, 17]) });
    const { info, moves } = legalFor(pos, WHITE, [5, 3]);
    eq(info.maxMoves, 2, 'dados a jugar');
    // 8/5 con el 3 deja el 5 sin jugar, así que no es legal.
    eq(sig(moves), ['8>3:5', '9>6:3']);
  });

  test('Si solo se puede jugar un dado, debe ser el mayor', () => {
    const pos = position({ w: { 8: 1, 20: 1 }, b: blackBlocks([14, 15]) });
    const { info, moves } = legalFor(pos, WHITE, [6, 5]);
    eq(info.maxMoves, 1, 'dados a jugar');
    eq(info.forcedDie, 6, 'dado obligado');
    eq(sig(moves), ['8>2:6']);
  });

  test('Si el mayor no se puede jugar, se juega el menor', () => {
    const pos = position({ w: { 8: 1, 20: 1 }, b: blackBlocks([2, 14, 15]) });
    const { info, moves } = legalFor(pos, WHITE, [6, 5]);
    eq(info.forcedDie, 5, 'dado obligado');
    eq(sig(moves), ['8>3:5']);
  });

  // -------------------------------------------------------- Sacar fichas

  test('Sacar: número exacto o mayor desde la punta más alta', () => {
    const pos = position({ w: { 5: 1, 2: 1, off: 13 } });
    const { moves } = legalFor(pos, WHITE, [6, 1]);
    eq(sig(moves), ['2>1:1', '5>0:6', '5>4:1']);
  });

  test('No se saca con un número mayor si hay fichas más altas', () => {
    const pos = position({ w: { 5: 1, 2: 1, off: 13 } });
    const s = sig(BG.singleMoves(pos, WHITE, 4));
    ok(!s.includes('2>0:4'), 'no debería sacar desde la 2');
    ok(s.includes('5>1:4'), 'debería mover 5/1');
  });

  test('No se saca con fichas fuera de casa', () => {
    const pos = position({ w: { 7: 1, 5: 1, off: 13 } });
    const { moves } = legalFor(pos, WHITE, [6, 5]);
    eq(sig(moves), ['7>1:6', '7>2:5']);
  });

  test('Las negras sacan fichas igual que las blancas', () => {
    const pos = position({ b: { 3: 2, off: 13 } });
    const { info, moves } = legalFor(pos, BLACK, [6, 6]);
    eq(info.maxMoves, 2, 'solo quedan dos fichas');
    eq(sig(moves), ['3>0:6']);
  });

  // ---------------------------------------------------------- Resultado

  test('Sencilla, gammon y backgammon', () => {
    eq(BG.resultKind(position({ w: { off: 15 }, b: { off: 1, 3: 14 } }), WHITE), 1, 'sencilla');
    eq(BG.resultKind(position({ w: { off: 15 }, b: { 10: 15 } }), WHITE), 2, 'gammon');
    eq(BG.resultKind(position({ w: { off: 15 }, b: { 20: 1, 10: 14 } }), WHITE), 3, 'backgammon (casa)');
    eq(BG.resultKind(position({ w: { off: 15 }, b: { bar: 1, 10: 14 } }), WHITE), 3, 'backgammon (barra)');
  });

  // ------------------------------------------------------------ Notación

  test('Notación de movimientos', () => {
    eq(BG.formatMoves([{ from: 13, to: 7, die: 6 }, { from: 8, to: 7, die: 1 }]), '13/7 8/7');
    eq(BG.formatMoves([{ from: 13, to: 7, die: 6 }, { from: 7, to: 6, die: 1 }]), '13/6');
    eq(BG.formatMoves([{ from: 24, to: 18, die: 6, hit: true }, { from: 18, to: 14, die: 4 }]), '24/18*/14');
    eq(BG.formatMoves([
      { from: 13, to: 7, die: 6 }, { from: 13, to: 7, die: 6 },
      { from: 7, to: 1, die: 6 }, { from: 7, to: 1, die: 6 },
    ]), '13/1(2)');
    eq(BG.formatMoves([{ from: BAR, to: 20, die: 5, hit: true }, { from: 6, to: OFF, die: 6 }]), 'bar/20* 6/off');
  });

  // ------------------------------------------------------------- Partida

  const seq = (...vals) => () => vals.shift();

  test('Tirada inicial: empate se repite y el mayor empieza con ambos dados', () => {
    const m = BG.Match.create({ matchLength: 5 });
    m.rollOpening(seq(4, 4));
    eq(m.s.phase, 'opening', 'tras empate');
    m.rollOpening(seq(3, 5));
    eq([m.s.phase, m.s.turn, m.s.dice], ['moving', BLACK, [5, 3]]);
  });

  test('Turno: deshacer, confirmar solo con la jugada completa y cambio de turno', () => {
    const m = BG.Match.create({ matchLength: 5 });
    m.rollOpening(seq(6, 1));
    ok(!m.confirm(), 'no debería confirmar a medias');
    ok(m.play(13, 7, 6), '13/7');
    ok(m.undo(), 'deshacer');
    eq(m.s.pos.points[13], 5, 'deshacer devuelve la ficha');
    ok(m.play(13, 7, 6) && m.play(8, 7, 1), 'jugada 13/7 8/7');
    ok(m.confirm(), 'confirmar');
    eq([m.s.phase, m.s.turn], ['preRoll', BLACK]);
  });

  test('Cubo: aceptar dobla y cambia de dueño; rechazar da los puntos', () => {
    const m = BG.Match.create({ matchLength: 7 });
    Object.assign(m.s, { phase: 'preRoll', turn: WHITE });
    ok(m.offerDouble(), 'ofrecer');
    ok(m.acceptDouble(), 'aceptar');
    eq(m.s.cube, { value: 2, owner: BLACK });
    ok(!m.canDouble(), 'las blancas ya no tienen el cubo');
    m.s.turn = BLACK;
    ok(m.offerDouble() && m.declineDouble(), 'redoblar y rechazar');
    eq([m.s.score, m.s.phase], [[0, 2], 'gameOver']);
  });

  test('Regla Crawford: un juego sin cubo, luego vuelve', () => {
    const m = BG.Match.create({ matchLength: 5 });
    m.s.score = [4, 2];
    m.s.phase = 'gameOver';
    m.nextGame();
    ok(m.s.isCrawford, 'debería ser juego Crawford');
    Object.assign(m.s, { phase: 'preRoll', turn: BLACK });
    ok(!m.canDouble(), 'no se puede doblar en el Crawford');
    m.s.phase = 'gameOver';
    m.nextGame();
    ok(!m.s.isCrawford, 'el siguiente ya no es Crawford');
    Object.assign(m.s, { phase: 'preRoll', turn: BLACK });
    ok(m.canDouble(), 'se puede doblar después del Crawford');
  });

  test('Fin de la partida al llegar a los puntos', () => {
    const m = BG.Match.create({ matchLength: 3 });
    m.s.score = [1, 0];
    m.s.pos = position({ w: { off: 15 }, b: { 10: 15 } });
    m._finish(WHITE, BG.resultKind(m.s.pos, WHITE), 'normal');
    eq([m.s.score, m.s.phase], [[3, 0], 'matchOver']);
  });

  test('Regla Jacoby: sin doblar, el gammon cuenta como sencilla', () => {
    const m = BG.Match.create({ matchLength: 0, jacoby: true });
    eq(m.pointsFor(2), 1, 'cubo sin tocar');
    m.s.cube.value = 2;
    eq(m.pointsFor(2), 4, 'cubo a 2');
  });

  test('Abandono: el rival acepta y gana los puntos ofrecidos', () => {
    const m = BG.Match.create({ matchLength: 0 });
    Object.assign(m.s, { phase: 'preRoll', turn: BLACK });
    m.s.cube = { value: 2, owner: BLACK };
    ok(m.offerResign(2), 'ofrecer gammon');
    ok(m.acceptResign(), 'aceptar');
    eq(m.s.score, [4, 0]);
  });

  // ----------------------------------------------------------- Resultados

  window.__testResults = results;
  const out = document.getElementById('out');
  const failed = results.filter((r) => !r.ok);
  document.getElementById('summary').textContent =
    `${results.length - failed.length} de ${results.length} pruebas superadas`;
  document.getElementById('summary').className = failed.length ? 'ko' : 'ok';
  for (const r of results) {
    const li = document.createElement('li');
    li.className = r.ok ? 'ok' : 'ko';
    li.textContent = (r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : ' — ' + r.error);
    out.appendChild(li);
  }
})();
