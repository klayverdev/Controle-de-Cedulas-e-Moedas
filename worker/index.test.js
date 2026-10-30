import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const ORIGEM = 'http://localhost:8080';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function ambiente(aiRun) {
  return { ALLOWED_ORIGIN: `${ORIGEM}, https://exemplo.github.io`, AI: { run: aiRun } };
}

function pedido({ metodo = 'POST', origem = ORIGEM, corpo = JPEG, caminho = '/reconhecer' } = {}) {
  const headers = { 'Content-Type': 'image/jpeg' };
  if (origem) headers.Origin = origem;
  return new Request(`https://worker.exemplo.dev${caminho}`, {
    method: metodo,
    headers,
    body: metodo === 'POST' ? corpo : undefined,
  });
}

test('sucesso: devolve as quantidades validadas e o cabeçalho CORS', async () => {
  const env = ambiente(async () => ({ response: 'Claro! {"50": 2, "0.50": 3, "999": 1}' }));
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('Access-Control-Allow-Origin'), ORIGEM);
  assert.deepEqual(await resposta.json(), { quantidades: { 50: 2, 0.5: 3 } });
});

test('aceita a resposta do modelo já como objeto', async () => {
  const env = ambiente(async () => ({ response: { 20: 4 } }));
  const resposta = await worker.fetch(pedido(), env);
  assert.deepEqual(await resposta.json(), { quantidades: { 20: 4 } });
});

test('envia a imagem em data URI e pede temperatura 0', async () => {
  let entrada;
  const env = ambiente(async (_modelo, dados) => {
    entrada = dados;
    return { response: '{"1": 1}' };
  });
  await worker.fetch(pedido(), env);
  const parteImagem = entrada.messages[0].content.find((p) => p.type === 'image_url');
  assert.match(parteImagem.image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(entrada.temperature, 0);
});

test('preflight OPTIONS: 204 para origem permitida e 403 para as demais', async () => {
  const env = ambiente(async () => ({}));
  const ok = await worker.fetch(pedido({ metodo: 'OPTIONS' }), env);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');

  const negado = await worker.fetch(pedido({ metodo: 'OPTIONS', origem: 'https://outro.site' }), env);
  assert.equal(negado.status, 403);
});

test('403 para origem não permitida ou ausente, sem chamar o modelo', async () => {
  let chamadas = 0;
  const env = ambiente(async () => {
    chamadas += 1;
    return {};
  });
  assert.equal((await worker.fetch(pedido({ origem: 'https://outro.site' }), env)).status, 403);
  assert.equal((await worker.fetch(pedido({ origem: '' }), env)).status, 403);
  assert.equal(chamadas, 0);
});

test('400 para corpo vazio, que não é JPEG ou maior que 1,5 MB', async () => {
  const env = ambiente(async () => ({ response: '{"1": 1}' }));
  assert.equal((await worker.fetch(pedido({ corpo: new Uint8Array(0) }), env)).status, 400);
  assert.equal((await worker.fetch(pedido({ corpo: new Uint8Array([1, 2, 3, 4, 5]) }), env)).status, 400);

  const grande = new Uint8Array(1.5 * 1024 * 1024 + 1);
  grande.set(JPEG);
  assert.equal((await worker.fetch(pedido({ corpo: grande }), env)).status, 400);
});

test('422 quando o modelo não devolve nenhuma quantidade válida', async () => {
  const env = ambiente(async () => ({ response: 'Não consigo ver nada.' }));
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 422);
});

test('429 quando o limite gratuito do dia acaba', async () => {
  const env = ambiente(async () => {
    throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 429);
});

test('502 para outras falhas do modelo', async () => {
  const env = ambiente(async () => {
    throw new Error('falha interna qualquer');
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 502);
});

test('404 para outras rotas e 405 para métodos diferentes de POST', async () => {
  const env = ambiente(async () => ({}));
  assert.equal((await worker.fetch(pedido({ caminho: '/outra' }), env)).status, 404);
  const get = new Request('https://worker.exemplo.dev/reconhecer', { method: 'GET', headers: { Origin: ORIGEM } });
  assert.equal((await worker.fetch(get, env)).status, 405);
});
