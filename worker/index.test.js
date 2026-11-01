import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const ORIGEM = 'http://localhost:8080';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const MISTRAL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct';
const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
const LLAMA32 = '@cf/meta/llama-3.2-11b-vision-instruct';

function ambiente(aiRun, extra = {}) {
  return { ALLOWED_ORIGIN: `${ORIGEM}, https://exemplo.github.io`, AI: { run: aiRun }, ...extra };
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

test('aceita a resposta do modelo como objeto ou no formato choices', async () => {
  const comoObjeto = ambiente(async () => ({ response: { 20: 4 } }));
  assert.deepEqual(await (await worker.fetch(pedido(), comoObjeto)).json(), { quantidades: { 20: 4 } });

  const comoChoices = ambiente(async () => ({ choices: [{ message: { content: '{"5": 3}' } }] }));
  assert.deepEqual(await (await worker.fetch(pedido(), comoChoices)).json(), { quantidades: { 5: 3 } });
});

test('envia a imagem dentro da mensagem (image_url), com temperatura 0, ao modelo preferido', async () => {
  const chamadas = [];
  const env = ambiente(async (modelo, dados) => {
    chamadas.push({ modelo, dados });
    return { response: '{"1": 1}' };
  });
  await worker.fetch(pedido(), env);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].modelo, MISTRAL);
  const { dados } = chamadas[0];
  assert.equal(dados.temperature, 0);
  assert.equal(dados.image, undefined, 'o campo image solto não deve ser usado');
  const partes = dados.messages[0].content;
  assert.match(partes.find((p) => p.type === 'image_url').image_url.url, /^data:image\/jpeg;base64,/);
  assert.match(partes.find((p) => p.type === 'text').text, /R\$ 0,50 é prateada/);
});

test('o prompt não puxa para zero: sem exemplo pronto e sem pedir para ignorar o duvidoso', async () => {
  let prompt = '';
  const env = ambiente(async (_modelo, dados) => {
    prompt = dados.messages[0].content.find((p) => p.type === 'text').text;
    return { response: '{"1": 1}' };
  });
  await worker.fetch(pedido(), env);
  assert.doesNotMatch(prompt, /Exemplo:/);
  assert.doesNotMatch(prompt, /duvidosos/);
});

test('passa para o próximo modelo quando o anterior dá erro, responde vazio ou só zeros', async () => {
  const usados = [];
  const env = ambiente(async (modelo) => {
    usados.push(modelo);
    if (modelo === MISTRAL) throw new Error('falha qualquer');
    if (modelo === SCOUT) return { response: { 1: 0, 50: 0 } };
    if (modelo === GEMMA) return { response: '' };
    return { response: '{"1": 4, "0.5": 5}' };
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { quantidades: { 1: 4, 0.5: 5 } });
  assert.deepEqual(usados, [MISTRAL, SCOUT, GEMMA, LLAMA32]);
});

test('para no primeiro modelo que acerta e não gasta os outros', async () => {
  const usados = [];
  const env = ambiente(async (modelo) => {
    usados.push(modelo);
    return modelo === SCOUT ? { response: '{"10": 2}' } : { response: '{"1": 0}' };
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.deepEqual(await resposta.json(), { quantidades: { 10: 2 } });
  assert.deepEqual(usados, [MISTRAL, SCOUT]);
});

test('429 imediato quando o limite gratuito do dia acaba, sem tentar outros modelos', async () => {
  let chamadas = 0;
  const env = ambiente(async () => {
    chamadas += 1;
    throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 429);
  assert.equal(chamadas, 1);
});

test('422 quando nenhum modelo devolve quantidade válida, mostrando o que cada um respondeu', async () => {
  const env = ambiente(async (modelo) => ({ response: modelo === MISTRAL ? { 1: 0, 50: 0 } : 'Não consigo ver nada.' }));
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 422);
  const corpo = await resposta.json();
  assert.equal(corpo.erro, 'Não consegui ler a foto.');
  assert.match(corpo.detalhe, /mistral-small-3\.1: .*"50":0/);
  assert.match(corpo.detalhe, /llama-4-scout: Não consigo ver nada\./);
  assert.match(corpo.detalhe, /gemma-4: Não consigo ver nada\./);
  assert.match(corpo.detalhe, /llama-3\.2-vision: Não consigo ver nada\./);
});

test('502 com detalhe quando todos os modelos dão erro', async () => {
  let chamadas = 0;
  const env = ambiente(async () => {
    chamadas += 1;
    throw new Error(`falha interna ${chamadas}`);
  });
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 502);
  const corpo = await resposta.json();
  assert.match(corpo.detalhe, /mistral-small-3\.1: erro falha interna 1/);
  assert.match(corpo.detalhe, /llama-3\.2-vision: erro falha interna 4/);
  assert.equal(chamadas, 4);
});

test('modo de comparação: roda todos os modelos e mostra a resposta de cada um, mesmo havendo acerto', async () => {
  const usados = [];
  const env = ambiente(
    async (modelo) => {
      usados.push(modelo);
      return { response: modelo === GEMMA ? 'texto sem json' : '{"1": 4, "0.5": 5}' };
    },
    { MODO_COMPARACAO: '1' },
  );
  const resposta = await worker.fetch(pedido(), env);
  assert.equal(resposta.status, 422);
  const corpo = await resposta.json();
  assert.equal(corpo.erro, 'Modo de comparação ligado.');
  assert.match(corpo.detalhe, /mistral-small-3\.1: \{"1":4,"0\.5":5\}/);
  assert.match(corpo.detalhe, /gemma-4: texto sem json/);
  assert.equal(usados.length, 4);
});

test('o modo de comparação só liga com o valor exato "1"', async () => {
  const env = ambiente(async () => ({ response: '{"1": 1}' }), { MODO_COMPARACAO: '0' });
  assert.equal((await worker.fetch(pedido(), env)).status, 200);
});

test('o detalhe nunca inclui a imagem e é limitado em tamanho', async () => {
  const env = ambiente(async () => ({ response: 'x'.repeat(5000) }));
  const corpo = await (await worker.fetch(pedido(), env)).json();
  assert.ok(corpo.detalhe.length <= 1203);
  assert.doesNotMatch(corpo.detalhe, /base64/);
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

test('404 para outras rotas e 405 para métodos diferentes de POST', async () => {
  const env = ambiente(async () => ({}));
  assert.equal((await worker.fetch(pedido({ caminho: '/outra' }), env)).status, 404);
  const get = new Request('https://worker.exemplo.dev/reconhecer', { method: 'GET', headers: { Origin: ORIGEM } });
  assert.equal((await worker.fetch(get, env)).status, 405);
});
