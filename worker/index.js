// Worker que lê uma foto de cédulas e moedas usando o Workers AI (plano gratuito).
// Rota única: POST /reconhecer, corpo = imagem JPEG.

import { extrairQuantidades, DENOMINACOES } from './validar.js';

const MODELO = '@cf/meta/llama-3.2-11b-vision-instruct';
const MAX_BYTES = 1.5 * 1024 * 1024;

const PROMPT = `Você está contando dinheiro brasileiro em uma foto.
Responda SOMENTE com um objeto JSON, sem nenhum outro texto.
As chaves devem ser exatamente estes valores em reais: ${DENOMINACOES.map((d) => `"${d}"`).join(', ')}.
Cada valor é a quantidade inteira de cédulas ou moedas daquele valor que aparecem na foto. Use 0 quando não houver.
Não conte itens cortados, escondidos ou duvidosos. Exemplo: {"50": 2, "20": 0, "0.5": 3}`;

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

    let resposta;
    try {
      resposta = await env.AI.run(MODELO, {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${paraBase64(bytes)}` } },
            ],
          },
        ],
        max_tokens: 200,
        temperature: 0,
      });
    } catch (erro) {
      // Nunca registrar a foto: só a mensagem de erro.
      console.error('Falha no Workers AI:', String(erro?.message || erro));
      if (erroDeLimite(erro)) return json({ erro: 'Limite gratuito do dia atingido.' }, 429, origem);
      return json({ erro: 'Falha ao chamar o modelo.' }, 502, origem);
    }

    const quantidades = extrairQuantidades(textoDaResposta(resposta));
    if (Object.keys(quantidades).length === 0) {
      return json({ erro: 'Não consegui ler a foto.' }, 422, origem);
    }
    return json({ quantidades }, 200, origem);
  },
};
