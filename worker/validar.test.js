import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairQuantidades } from './validar.js';

test('aceita um JSON correto e descarta zeros', () => {
  const texto = '{"50": 2, "20": 0, "0.5": 3}';
  assert.deepEqual(extrairQuantidades(texto), { 50: 2, 0.5: 3 });
});

test('encontra o JSON no meio de texto ao redor', () => {
  const texto = 'Aqui está a contagem:\n```json\n{"100": 1, "1": 4}\n```\nEspero ter ajudado.';
  assert.deepEqual(extrairQuantidades(texto), { 100: 1, 1: 4 });
});

test('descarta chaves que não são denominações', () => {
  assert.deepEqual(extrairQuantidades('{"500": 1, "3": 2, "abc": 5, "10": 2}'), { 10: 2 });
});

test('normaliza chaves com zeros extras, vírgula e prefixo R$', () => {
  const texto = '{"0.50": 1, "50.00": 2, "R$ 20": 3, "0,25": 4}';
  assert.deepEqual(extrairQuantidades(texto), { 0.5: 1, 50: 2, 20: 3, 0.25: 4 });
});

test('descarta valores negativos, decimais, texto não numérico e acima do teto', () => {
  const texto = '{"50": -1, "20": 2.5, "10": "três", "5": 201, "2": 200, "1": "1.5"}';
  assert.deepEqual(extrairQuantidades(texto), { 2: 200 });
});

test('aceita quantidades escritas como texto de dígitos', () => {
  assert.deepEqual(extrairQuantidades('{"50": "2", "0.5": " 3 ", "20": "0"}'), { 50: 2, 0.5: 3 });
});

test('devolve vazio para resposta sem JSON, vazia ou inválida', () => {
  assert.deepEqual(extrairQuantidades(''), {});
  assert.deepEqual(extrairQuantidades('Não consigo ver as notas.'), {});
  assert.deepEqual(extrairQuantidades('{"50": 2'), {});
  assert.deepEqual(extrairQuantidades('{50: 2}'), {});
  assert.deepEqual(extrairQuantidades(undefined), {});
  assert.deepEqual(extrairQuantidades(null), {});
});

test('devolve vazio quando o JSON não é um objeto', () => {
  assert.deepEqual(extrairQuantidades('[1, 2, 3]'), {});
});
