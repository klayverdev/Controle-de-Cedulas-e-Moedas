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

function recortar(texto, limite = 400) {
  const limpo = String(texto).replace(/\s+/g, ' ').trim();
  return limpo.length > limite ? `${limpo.slice(0, limite)}...` : limpo;
}

// Formatos de entrada, do mais provável para o menos provável de funcionar.
function formatosDeEntrada(imagem, prompt = PROMPT) {
  const comum = { max_tokens: 250, temperature: 0 };
  return [
    // 1. Tutorial oficial: texto em `messages` e a imagem no campo `image`.
    {
      messages: [
        { role: 'system', content: 'Você conta cédulas e moedas brasileiras em fotos e responde somente com JSON.' },
        { role: 'user', content: prompt },
      ],
      image: imagem,
      ...comum,
    },
    // 2. Estilo OpenAI: a imagem dentro do conteúdo da mensagem.
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imagem } },
          ],
        },
      ],
      ...comum,
    },
    // 3. Prompt simples com a imagem.
    { prompt, image: imagem, ...comum },
  ];
}

// Quando nenhum formato devolve quantidades, pergunta ao modelo o que ele vê na foto.
// Serve para saber se o problema é a imagem não chegar ou o modelo não saber contar.
async function diagnosticar(env, imagem, indiceFormato) {
  const perguntas = [
    ['descrição', 'Descreva em português tudo o que aparece nesta foto.'],
    ['lista', 'Liste cada moeda e cada cédula que aparece nesta foto, uma por linha, com o valor em reais de cada uma. Se não houver nenhuma, diga "nenhuma".'],
  ];
  const partes = [];
  for (const [rotulo, pergunta] of perguntas) {
    try {
      const resposta = await env.AI.run(MODELO, formatosDeEntrada(imagem, pergunta)[indiceFormato]);
      partes.push(`${rotulo}: ${textoDaResposta(resposta) || '(vazio)'}`);
    } catch (erro) {
      partes.push(`${rotulo}: erro ${String(erro?.message || erro)}`);
    }
  }
  return partes.join(' | ');
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

    // O Workers AI aceita a imagem em formatos diferentes e nem todos funcionam com este modelo.
    // Tenta um por vez e para no primeiro que devolver quantidades válidas.
    const imagem = `data:image/jpeg;base64,${paraBase64(bytes)}`;
    const respostas = [];
    const falhas = [];
    let primeiroQueRespondeu = -1;

    for (const [indice, entrada] of formatosDeEntrada(imagem).entries()) {
      try {
        const resposta = await env.AI.run(MODELO, entrada);
        const texto = textoDaResposta(resposta);
        const quantidades = extrairQuantidades(texto);
        if (Object.keys(quantidades).length > 0) return json({ quantidades }, 200, origem);
        if (primeiroQueRespondeu === -1) primeiroQueRespondeu = indice;
        respostas.push(`formato ${indice + 1}: ${texto || '(vazio)'}`);
      } catch (erro) {
        // Nunca registrar a foto: só a mensagem de erro.
        const mensagem = String(erro?.message || erro);
        console.error(`Falha no Workers AI (formato ${indice + 1}):`, mensagem);
        if (erroDeLimite(erro)) return json({ erro: 'Limite gratuito do dia atingido.' }, 429, origem);
        falhas.push(`formato ${indice + 1}: ${mensagem}`);
      }
    }

    // Se algum formato chegou a responder, o modelo "leu" mas não achou nada válido.
    if (respostas.length > 0) {
      const resumo = `${respostas.length} formato(s) responderam sem quantidades (${recortar(respostas[0], 140)})`;
      const visto = await diagnosticar(env, imagem, primeiroQueRespondeu);
      return json({ erro: 'Não consegui ler a foto.', detalhe: recortar(`${resumo} | ${visto}`, 900) }, 422, origem);
    }
    return json({ erro: 'Falha ao chamar o modelo.', detalhe: recortar(falhas.join(' | ')) }, 502, origem);
  },
};
