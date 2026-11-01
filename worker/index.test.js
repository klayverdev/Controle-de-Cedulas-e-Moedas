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

test('primeiro formato: imagem no campo image (data URI), texto em messages e temperatura 0', async () => {
  let entrada;
  let modelo;
  const env = ambiente(async (nomeDoModelo, dados) => {
    modelo = nomeDoModelo;
    entrada = dados;
    return { response: '{"1": 1}' };
  });
  await worker.fetch(pedido(), env);
  assert.equal(modelo, '@cf/meta/llama-3.2-11b-vision-instruct');
  assert.match(entrada.image, /^data:image\/jpeg;base64,/);
  assert.equal(entrada.messages.at(-1).role, 'user');
  assert.equal(typeof entrada.messages.at(-1).content, 'string');
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

test('422 quando nenhum formato devolve quantidade válida, e mostra o que o modelo respondeu', async () => {
  let chamadas = 0;
  const env = ambiente(async () => {
    chamadas += 1;
    return { response: chamadas === 1 ? { 1: 0, 50: 0 } : 'Não consigo ver nada.' };
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 422);
  const corpo = await resposta.json();
  assert.equal(corpo.erro, 'Não consegui ler a foto.');
  assert.match(corpo.detalhe, /3 formato\(s\) responderam sem quantidades \(formato 1: .*"50":0/);
  // 3 formatos + 2 perguntas de diagnóstico (descrição e lista)
  assert.match(corpo.detalhe, /descrição: Não consigo ver nada\./);
  assert.match(corpo.detalhe, /lista: Não consigo ver nada\./);
  assert.equal(chamadas, 5);
});

test('o diagnóstico pergunta o que há na foto usando o formato que respondeu e não derruba a resposta se falhar', async () => {
  const entradas = [];
  const env = ambiente(async (_modelo, dados) => {
    entradas.push(dados);
    if (entradas.length === 4) throw new Error('falha só no diagnóstico');
    return { response: entradas.length <= 3 ? { 1: 0 } : 'Vejo moedas.' };
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 422);
  const corpo = await resposta.json();
  assert.match(corpo.detalhe, /descrição: erro falha só no diagnóstico/);
  assert.match(corpo.detalhe, /lista: Vejo moedas\./);
  // O diagnóstico reutiliza o formato 1 (campo image) e troca só a pergunta.
  assert.ok(entradas[3].image && entradas[4].image);
  assert.match(entradas[3].messages.at(-1).content, /Descreva/);
  assert.match(entradas[4].messages.at(-1).content, /Liste cada moeda/);
});

test('tenta o formato seguinte quando o primeiro dá erro', async () => {
  const formatos = [];
  const env = ambiente(async (_modelo, dados) => {
    formatos.push(dados);
    if (formatos.length === 1) throw new Error('3030: Unable to add image when there are no user-supplied messages');
    return { response: '{"20": 3}' };
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { quantidades: { 20: 3 } });
  assert.equal(formatos.length, 2);
  assert.ok(formatos[0].image, 'o formato 1 usa o campo image');
  const parteImagem = formatos[1].messages[0].content.find((p) => p.type === 'image_url');
  assert.match(parteImagem.image_url.url, /^data:image\/jpeg;base64,/);
});

test('tenta o formato seguinte quando o primeiro responde só zeros', async () => {
  let chamadas = 0;
  const env = ambiente(async () => {
    chamadas += 1;
    return { response: chamadas === 1 ? { 1: 0, 50: 0 } : { 1: 4, 0.5: 5 } };
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { quantidades: { 1: 4, 0.5: 5 } });
  assert.equal(chamadas, 2);
});

test('429 imediato quando o limite gratuito do dia acaba, sem tentar outros formatos', async () => {
  let chamadas = 0;
  const env = ambiente(async () => {
    chamadas += 1;
    throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 429);
  assert.equal(chamadas, 1);
});

test('502 com detalhe quando todos os formatos dão erro', async () => {
  let chamadas = 0;
  const env = ambiente(async () => {
    chamadas += 1;
    throw new Error(`falha interna ${chamadas}`);
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 502);
  const corpo = await resposta.json();
  assert.match(corpo.detalhe, /formato 1: falha interna 1/);
  assert.match(corpo.detalhe, /formato 3: falha interna 3/);
  assert.equal(chamadas, 3);
});

test('o detalhe nunca inclui a imagem e é limitado em tamanho', async () => {
  const env = ambiente(async () => ({ response: 'x'.repeat(5000) }));
  const resposta = await worker.fetch(pedido(), env);
  const corpo = await resposta.json();
  assert.ok(corpo.detalhe.length <= 903);
  assert.doesNotMatch(corpo.detalhe, /base64/);
});

test('404 para outras rotas e 405 para métodos diferentes de POST', async () => {
  const env = ambiente(async () => ({}));
  assert.equal((await worker.fetch(pedido({ caminho: '/outra' }), env)).status, 404);
  const get = new Request('https://worker.exemplo.dev/reconhecer', { method: 'GET', headers: { Origin: ORIGEM } });
  assert.equal((await worker.fetch(get, env)).status, 405);
});
