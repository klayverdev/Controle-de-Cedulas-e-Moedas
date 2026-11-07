'use strict';
// Testes da contagem de moedas. Rode com `npm install` e depois `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classificarMoedas, contarMoedasDaImagem } = require('./contagem-moedas.js');

// Cores no padrão do OpenCV (matiz 0-179, saturação 0-255), medidas na foto real de teste.
const prata = (r) => ({ r, satCentro: 44, satBorda: 42, matizBorda: 19 });
const bicolor = (r) => ({ r, satCentro: 30, satBorda: 90, matizBorda: 17 });
const dourada = (r) => ({ r, satCentro: 95, satBorda: 92, matizBorda: 18 });
const cobre = (r) => ({ r, satCentro: 110, satBorda: 107, matizBorda: 13 });

test('com uma moeda de R$ 1 na foto, ela vira a régua de tamanho', () => {
  const { quantidades } = classificarMoedas(
    [bicolor(39), bicolor(39), prata(36), prata(36), prata(36), dourada(37), dourada(29), dourada(29), cobre(32)],
    1600,
  );
  assert.deepEqual(quantidades, { 1: 2, 0.5: 3, 0.25: 1, 0.1: 2, 0.05: 1 });
});

test('a mesma foto aproximada (raios 2x maiores) dá o mesmo resultado', () => {
  const dobro = (c) => ({ ...c, r: c.r * 2 });
  const lista = [bicolor(39), prata(36), dourada(37), dourada(29), cobre(32)].map(dobro);
  assert.deepEqual(classificarMoedas(lista, 3200).quantidades, { 1: 1, 0.5: 1, 0.25: 1, 0.1: 1, 0.05: 1 });
});

test('sem moeda de R$ 1, usa o tamanho esperado em relação à imagem', () => {
  const { quantidades } = classificarMoedas([prata(36), dourada(37), dourada(29), cobre(32)], 1600);
  assert.deepEqual(quantidades, { 1: 0, 0.5: 1, 0.25: 1, 0.1: 1, 0.05: 1 });
});

test('prata pequena (menor que uma de R$ 0,50) é contada como R$ 0,05', () => {
  const { quantidades } = classificarMoedas([bicolor(39), prata(30), prata(36)], 1600);
  assert.deepEqual(quantidades, { 1: 1, 0.5: 1, 0.25: 0, 0.1: 0, 0.05: 1 });
});

test('lista vazia não quebra', () => {
  assert.deepEqual(classificarMoedas([], 1600).quantidades, { 1: 0, 0.5: 0, 0.25: 0, 0.1: 0, 0.05: 0 });
});

// Foto real de uma gaveta, com contagem conferida moeda a moeda (ver README).
test('foto real: acha todas as moedas e acerta os tipos', { timeout: 120000 }, async (t) => {
  let cv;
  let jpeg;
  try {
    cv = require('@techstark/opencv-js');
    jpeg = require('jpeg-js');
  } catch {
    return t.skip('instale as dependências com `npm install` para rodar este teste');
  }
  if (!cv.Mat) await new Promise((ok) => { cv.onRuntimeInitialized = ok; });

  const foto = jpeg.decode(fs.readFileSync(path.join(__dirname, 'test-fotos', 'moedas-gaveta-113.jpg')), {
    useTArray: true,
    formatAsRGBA: true,
  });
  const imageData = { width: foto.width, height: foto.height, data: new Uint8ClampedArray(foto.data) };
  const { total, quantidades } = contarMoedasDaImagem(cv, imageData);

  // Contagem do dono da gaveta: 19 / 23 / 23 / 29 / 19 (113). Conferência visual: 114 moedas.
  // As diferenças vêm de 2 moedas prateadas soltas nos montes dourados (idênticas a R$ 0,50 na cor
  // e no tamanho) e de 1 moeda de R$ 1 a mais.
  assert.ok(Math.abs(total - 114) <= 1, `total ${total}`);
  assert.deepEqual(quantidades, { 1: 20, 0.5: 25, 0.25: 21, 0.1: 29, 0.05: 19 });
});
