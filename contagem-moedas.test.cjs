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

test('prateada isolada vale R$ 0,50; prateada minúscula perto de uma R$ 1 é só o miolo dela', () => {
  assert.deepEqual(classificarMoedas([bicolor(48), prata(38)], 1600).quantidades, { 1: 1, 0.5: 1, 0.25: 0, 0.1: 0, 0.05: 0 });
  assert.deepEqual(classificarMoedas([bicolor(48), prata(31)], 1600).quantidades, { 1: 2, 0.5: 0, 0.25: 0, 0.1: 0, 0.05: 0 });
});

test('prateada solta no meio de um monte dourado vale o mesmo que as vizinhas', () => {
  const na = (c, x, y) => ({ ...c, x, y });
  const lista = [
    na(prata(36), 0, 0), na(prata(36), 80, 0), na(prata(36), 40, 70), // monte de R$ 0,50
    na(dourada(37), 1000, 0), na(dourada(37), 1075, 0), na(prata(36), 1040, 65), // prateada entre as douradas
    na(bicolor(39), 3000, 0),
  ];
  assert.deepEqual(classificarMoedas(lista, 1600).quantidades, { 1: 1, 0.5: 3, 0.25: 3, 0.1: 0, 0.05: 0 });
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

  // Contagem do dono da gaveta: 19 / 23 / 23 / 29 / 19 (113). Conferência visual: 114 moedas,
  // sendo a única diferença 1 moeda de R$ 1 a mais (20 visíveis na foto).
  assert.ok(Math.abs(total - 114) <= 1, `total ${total}`);
  const esperado = { 1: 19, 0.5: 23, 0.25: 23, 0.1: 29, 0.05: 19 };
  for (const [valor, n] of Object.entries(esperado)) {
    assert.ok(Math.abs(quantidades[valor] - n) <= 1, `R$ ${valor}: contou ${quantidades[valor]}, esperado ${n}`);
  }
});

// Segunda foto, de outra luz e de outro celular. Contagem feita olhando a imagem; a prateada solta
// com "25" gravado (sem vizinhas) não tem como ser identificada só pela cor e pelo tamanho.
test('foto real 2: acha as moedas e separa os tipos', { timeout: 120000 }, async (t) => {
  let cv;
  let jpeg;
  try {
    cv = require('@techstark/opencv-js');
    jpeg = require('jpeg-js');
  } catch {
    return t.skip('instale as dependências com `npm install` para rodar este teste');
  }
  if (!cv.Mat) await new Promise((ok) => { cv.onRuntimeInitialized = ok; });
  const foto = jpeg.decode(fs.readFileSync(path.join(__dirname, 'test-fotos', 'moedas-mesa-112.jpg')), {
    useTArray: true,
    formatAsRGBA: true,
  });
  const { total, quantidades } = contarMoedasDaImagem(cv, {
    width: foto.width,
    height: foto.height,
    data: new Uint8ClampedArray(foto.data),
  });
  assert.ok(Math.abs(total - 112) <= 2, `total ${total}`);
  assert.equal(quantidades[1], 20);
  assert.ok(Math.abs(quantidades[0.5] - 21) <= 2, `R$ 0,50: ${quantidades[0.5]}`);
  assert.ok(Math.abs(quantidades[0.25] - 22) <= 2, `R$ 0,25: ${quantidades[0.25]}`);
  assert.ok(Math.abs(quantidades[0.1] - 29) <= 2, `R$ 0,10: ${quantidades[0.1]}`);
  assert.ok(Math.abs(quantidades[0.05] - 19) <= 2, `R$ 0,05: ${quantidades[0.05]}`);
});
