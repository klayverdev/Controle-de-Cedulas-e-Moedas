// Worker que lê uma foto de cédulas e moedas usando o Workers AI (plano gratuito).
// Rota única: POST /reconhecer, corpo = imagem JPEG.

import { extrairQuantidades, DENOMINACOES } from './validar.js';

const MAX_BYTES = 1.5 * 1024 * 1024;

// Modelos de visão, do preferido para o último recurso. Testes diretos mostraram que todos
// enxergam a imagem quando ela vai dentro da mensagem (`image_url`). O formato com o campo
// `image` solto é ignorado por alguns deles e levaria o modelo a inventar números.
const MODELOS = [
  { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', rotulo: 'mistral-small-3.1', maxTokens: 300 },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', rotulo: 'llama-4-scout', maxTokens: 300 },
  // O Gemma 4 raciocina antes de responder; com pouco espaço ele devolve texto vazio.
  { id: '@cf/google/gemma-4-26b-a4b-it', rotulo: 'gemma-4', maxTokens: 1500 },
  { id: '@cf/meta/llama-3.2-11b-vision-instruct', rotulo: 'llama-3.2-vision', maxTokens: 300 },
];

const PROMPT = `Você é um caixa de loja contando dinheiro brasileiro (reais) em uma foto.
Conte TODAS as cédulas e moedas que aparecem inteiras na foto, uma a uma. Ignore reflexos e itens cortados nas bordas.
Como identificar:
- Moedas: R$ 1 é dourada com o centro prateado; R$ 0,50 é prateada; R$ 0,25 é cor de bronze e maior; R$ 0,10 é cor de bronze e menor; R$ 0,05 é cor de cobre.
- Cédulas: R$ 2 azul-acinzentada; R$ 5 roxa; R$ 10 vermelha; R$ 20 amarela; R$ 50 marrom; R$ 100 azul; R$ 200 cinza.
Responda SOMENTE com um objeto JSON, sem nenhum outro texto, com estas chaves (valor em reais): ${DENOMINACOES.map((d) => `"${d}"`).join(', ')}.
Cada valor é o número inteiro de unidades daquele tipo que aparecem na foto (0 se não houver nenhuma).`;

function origensPermitidas(env) {
  return String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((origem) => origem.trim())
    .filter(Boolean);
}

function cabecalhosCors(origem) {
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(corpo, status, origem) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(origem ? cabecalhosCors(origem) : {}) },
  });
}

function ehJpeg(bytes) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function paraBase64(bytes) {
  let texto = '';
  const bloco = 0x8000;
  for (let i = 0; i < bytes.length; i += bloco) {
    texto += String.fromCharCode(...bytes.subarray(i, i + bloco));
  }
  return btoa(texto);
}

function textoDaResposta(resposta) {
  const bruto = resposta?.response ?? resposta?.choices?.[0]?.message?.content;
  if (bruto && typeof bruto === 'object') return JSON.stringify(bruto);
  return typeof bruto === 'string' ? bruto : '';
}

function recortar(texto, limite = 400) {
  const limpo = String(texto).replace(/\s+/g, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite)}...` : limpo;
}

function entradaDaImagem(imagem, maxTokens) {
  return {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: imagem } },
        ],
      },
    ],
    max_tokens: maxTokens,
    temperature: 0,
  };
}

function erroDeLimite(erro) {
  return /4006|daily|allocation|neurons|rate limit|too many requests/i.test(String(erro?.message || erro));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origem = request.headers.get('Origin') || '';
    const permitidas = origensPermitidas(env);
    const origemOk = permitidas.includes(origem);

    if (url.pathname !== '/reconhecer') return json({ erro: 'Rota não encontrada.' }, 404, origemOk ? origem : '');

    if (request.method === 'OPTIONS') {
      if (!origemOk) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cabecalhosCors(origem) });
    }
    if (request.method !== 'POST') return json({ erro: 'Use POST.' }, 405, origemOk ? origem : '');
    if (!origemOk) return json({ erro: 'Origem não permitida.' }, 403, '');

    const tamanhoDeclarado = Number(request.headers.get('Content-Length') || 0);
    if (tamanhoDeclarado > MAX_BYTES) return json({ erro: 'Imagem grande demais.' }, 400, origem);

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES || !ehJpeg(bytes)) {
      return json({ erro: 'Imagem inválida ou grande demais.' }, 400, origem);
    }

    // Tenta um modelo por vez e para no primeiro que devolver quantidades válidas.
    // Com MODO_COMPARACAO=1 roda todos e devolve o que cada um respondeu (só para avaliar modelos).
    const comparar = env.MODO_COMPARACAO === '1';
    const imagem = `data:image/jpeg;base64,${paraBase64(bytes)}`;
    const relatorio = [];
    let vencedor = null;
    let responderam = 0;

    for (const modelo of MODELOS) {
      try {
        const resposta = await env.AI.run(modelo.id, entradaDaImagem(imagem, modelo.maxTokens));
        responderam += 1;
        const texto = textoDaResposta(resposta);
        const quantidades = extrairQuantidades(texto);
        const valido = Object.keys(quantidades).length > 0;
        relatorio.push(`${modelo.rotulo}: ${valido ? JSON.stringify(quantidades) : texto || '(vazio)'}`);
        if (valido && !vencedor) {
          vencedor = quantidades;
          if (!comparar) break;
        }
      } catch (erro) {
        // Nunca registrar a foto: só a mensagem de erro.
        const mensagem = String(erro?.message || erro);
        console.error(`Falha no Workers AI (${modelo.rotulo}):`, mensagem);
        if (erroDeLimite(erro)) return json({ erro: 'Limite gratuito do dia atingido.' }, 429, origem);
        relatorio.push(`${modelo.rotulo}: erro ${mensagem}`);
      }
    }

    if (comparar) {
      return json({ erro: 'Modo de comparação ligado.', detalhe: recortar(relatorio.join(' | '), 1500) }, 422, origem);
    }
    if (vencedor) return json({ quantidades: vencedor }, 200, origem);
    if (responderam > 0) {
      return json({ erro: 'Não consegui ler a foto.', detalhe: recortar(relatorio.join(' | '), 1200) }, 422, origem);
    }
    return json({ erro: 'Falha ao chamar o modelo.', detalhe: recortar(relatorio.join(' | '), 1200) }, 502, origem);
  },
};
