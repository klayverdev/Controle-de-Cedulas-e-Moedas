// Mede a precisão da leitura com fotos reais, antes de confiar no recurso.
//
// Uso:
//   node teste-precisao.mjs <pasta-com-fotos> <gabarito.json> <url-da-worker> [origem]
//
// O gabarito diz o que realmente há em cada foto:
//   { "foto1.jpg": { "50": 2, "0.5": 3 }, "foto2.jpg": { "20": 1 } }
//
// Use fotos JPG de até 1,5 MB (o app reduz as fotos antes de enviar; aqui elas vão como estão).
// A "origem" precisa estar em ALLOWED_ORIGIN no wrangler.toml. Padrão: http://localhost:8080
// Critério combinado no spec: o recurso segue se o total sair certo em pelo menos 80% das fotos.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [pasta, arquivoGabarito, urlWorker, origem = 'http://localhost:8080'] = process.argv.slice(2);

if (!pasta || !arquivoGabarito || !urlWorker) {
  console.error('Uso: node teste-precisao.mjs <pasta-com-fotos> <gabarito.json> <url-da-worker> [origem]');
  process.exit(1);
}

const gabarito = JSON.parse(await readFile(arquivoGabarito, 'utf8'));
const DENOMINACOES = ['200', '100', '50', '20', '10', '5', '2', '1', '0.5', '0.25', '0.1', '0.05'];

const total = (quantidades) =>
  Object.entries(quantidades).reduce((soma, [valor, qtd]) => soma + Number(valor) * qtd, 0);
const reais = (valor) => `R$ ${valor.toFixed(2)}`;

const acertosPorDenominacao = Object.fromEntries(DENOMINACOES.map((d) => [d, { certo: 0, vistos: 0 }]));
let totaisCertos = 0;
let fotosLidas = 0;
const nomes = Object.keys(gabarito);

for (const nome of nomes) {
  const esperado = gabarito[nome];
  const bytes = await readFile(path.join(pasta, nome));

  if (bytes.length > 1.5 * 1024 * 1024) {
    console.log(`${nome}: PULADA (mais de 1,5 MB; reduza a foto)`);
    continue;
  }

  let resposta;
  try {
    resposta = await fetch(`${urlWorker.replace(/\/$/, '')}/reconhecer`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', Origin: origem },
      body: bytes,
    });
  } catch (erro) {
    console.log(`${nome}: FALHA DE REDE (${erro.message})`);
    continue;
  }

  if (!resposta.ok) {
    console.log(`${nome}: ERRO ${resposta.status} ${await resposta.text()}`);
    continue;
  }

  const { quantidades: lido } = await resposta.json();
  fotosLidas += 1;

  const totalCerto = Math.abs(total(lido) - total(esperado)) < 0.001;
  if (totalCerto) totaisCertos += 1;

  for (const d of DENOMINACOES) {
    const qEsperada = esperado[d] || 0;
    const qLida = lido[d] || 0;
    if (qEsperada === 0 && qLida === 0) continue;
    acertosPorDenominacao[d].vistos += 1;
    if (qEsperada === qLida) acertosPorDenominacao[d].certo += 1;
  }

  const diferencas = DENOMINACOES.filter((d) => (esperado[d] || 0) !== (lido[d] || 0)).map(
    (d) => `R$ ${d}: esperado ${esperado[d] || 0}, lido ${lido[d] || 0}`,
  );
  console.log(
    `${nome}: ${totalCerto ? 'TOTAL CERTO' : 'TOTAL ERRADO'} (esperado ${reais(total(esperado))}, lido ${reais(total(lido))})` +
      (diferencas.length ? `\n    ${diferencas.join('\n    ')}` : ''),
  );
}

console.log('\nAcerto por denominação (quantidade exata, só onde apareceu na foto ou na leitura):');
for (const d of DENOMINACOES) {
  const { certo, vistos } = acertosPorDenominacao[d];
  if (vistos > 0) console.log(`  R$ ${d.padStart(4)}: ${certo} de ${vistos}`);
}

const meta = Math.ceil(nomes.length * 0.8);
console.log(`\nTotal certo em ${totaisCertos} de ${nomes.length} fotos (${fotosLidas} lidas).`);
console.log(
  totaisCertos >= meta
    ? `Critério atingido (mínimo ${meta}): vale seguir com o recurso.`
    : `Critério NÃO atingido (mínimo ${meta}): reavaliar o modelo antes de seguir.`,
);
