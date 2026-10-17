// Carga index.html y script.js en jsdom y juega partidas completas con tiradas fijas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const raiz = join(import.meta.dirname, '..');
const html = readFileSync(join(raiz, 'index.html'), 'utf8').replace('<script src="script.js"></script>', '');
const script = readFileSync(join(raiz, 'script.js'), 'utf8');

/** Abre el juego con un localStorage dado y las tiradas que devolverá el dado. */
function abrir({ tiradas = [], storage = {} } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  // jsdom no implementa innerText (el juego lo usa para puntajes y títulos).
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    set(valor) { this.textContent = valor; }
  });
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  // Las esperas de la animación se ejecutan al instante y el dado sale en el orden pedido.
  w.setTimeout = (fn) => { fn(); return 0; };
  const cola = [...tiradas];
  w.Math.random = () => ((cola.shift() ?? 1) - 0.5) / 6;
  w.alert = (m) => { w.alertas = [...(w.alertas ?? []), m]; };
  w.eval(script);
  w.dispatchEvent(new w.Event('load'));
  const $ = (s) => w.document.querySelector(s);
  return { w, $, empezar(n1 = 'Ana', n2 = 'Luis') {
    $('#player1Name').value = n1;
    $('#player2Name').value = n2;
    $('#startGame').click();
  }, lanzar(veces = 1) { for (let i = 0; i < veces; i++) $('#rollDice').click(); } };
}

test('una partida dura tres rondas y termina en la ronda 3', () => {
  const j = abrir({ tiradas: [6, 1, 5, 2, 4, 3] });
  j.empezar();
  j.lanzar(6);

  assert.equal(j.$('#score1').textContent, '15');
  assert.equal(j.$('#score2').textContent, '6');
  assert.equal(j.$('#round').textContent, '3');
  assert.match(j.$('#winnerMessage').textContent, /Ana gana/);
  assert.equal(j.$('#rollDice').disabled, true);
  // Seis lanzamientos más la fila del ganador.
  assert.equal(j.$('#history').rows.length - 1, 7);
});

test('un nombre con HTML se muestra como texto y no se ejecuta', () => {
  const nombre = '<img src=x onerror="window.hackeado=1">';
  const j = abrir({ tiradas: [3] });
  j.empezar(nombre, 'Luis');
  j.lanzar();

  const celda = j.$('#history').rows[1].cells[0];
  assert.equal(celda.textContent, nombre);
  assert.equal(j.$('#history img'), null);
  assert.equal(j.w.hackeado, undefined);
});

test('el historial guardado también se carga como texto', () => {
  const j = abrir({ storage: { historial: JSON.stringify([{ jugador: '<b>Ana</b>', lanzamiento: '4' }]) } });
  const celda = j.$('#history').rows[1].cells[0];
  assert.equal(celda.textContent, '<b>Ana</b>');
  assert.equal(j.$('#history b'), null);
});

test('sin mejor jugador las partidas guardadas no llevan trofeo', () => {
  const j = abrir({ tiradas: [2, 2, 3, 3, 4, 4] });
  j.empezar();
  j.lanzar(6);   // empate: no hay mejor jugador

  const partidas = [...j.w.document.querySelectorAll('#savedGames li')];
  assert.equal(partidas.length, 1);
  assert.doesNotMatch(partidas[0].textContent, /🏆/);
});

test('el ganador con mejor puntaje recibe el trofeo y reiniciar el récord se lo quita', () => {
  const j = abrir({ tiradas: [6, 1, 6, 1, 6, 1] });
  j.empezar();
  j.lanzar(6);

  assert.equal(j.w.localStorage.getItem('bestScore'), '18');
  assert.equal(j.$('#bestScore').textContent, 'Mejor Puntuación: 18');
  assert.match(j.$('.player h2').textContent, /🏆/);
  assert.match(j.$('#savedGames li').textContent, /🏆/);

  j.$('#resetBestScore').click();

  assert.equal(j.w.localStorage.getItem('bestScorePlayer'), null);
  assert.doesNotMatch(j.$('.player h2').textContent, /🏆/);
  assert.doesNotMatch(j.$('#savedGames li').textContent, /🏆/);
});

test('reiniciar con jugadores nuevos no duplica el inicio de partida', () => {
  const j = abrir({ tiradas: [6, 1, 6, 1, 6, 1, 2] });
  j.empezar();
  j.lanzar(6);

  for (let vez = 0; vez < 2; vez++) {
    j.$('#resetGame').click();
    j.w.document.getElementById('addNewPlayers').click();
    // Con un nombre vacío el inicio debe avisar una sola vez (antes se acumulaban listeners).
    j.$('#player1Name').value = '';
    j.$('#startGame').click();
  }
  assert.equal(j.w.alertas.length, 2);

  j.empezar('Carla', 'Diego');
  j.lanzar();
  assert.equal(j.$('#history').rows[1].cells[0].textContent, 'Carla');
});

test('falta un nombre: no empieza', () => {
  const j = abrir();
  j.empezar('Ana', '   ');
  assert.equal(j.w.alertas.length, 1);
  assert.ok(j.$('#popup').classList.contains('show'));
});
