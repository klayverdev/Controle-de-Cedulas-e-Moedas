// Transforma o texto devolvido pelo modelo em quantidades válidas.
// Função pura: não depende de rede, por isso é testada com `node --test`.

export const DENOMINACOES = ['200', '100', '50', '20', '10', '5', '2', '1', '0.5', '0.25', '0.1', '0.05'];
export const MAX_QUANTIDADE = 200;

/**
 * Procura o primeiro objeto JSON no texto e devolve só o que serve:
 * chaves entre as 12 denominações, valores inteiros de 1 a MAX_QUANTIDADE.
 * Chaves como "0.50" ou "50.00" são normalizadas para "0.5" e "50".
 * Se nada servir, devolve um objeto vazio.
 */
export function extrairQuantidades(texto) {
  if (typeof texto !== 'string') return {};

  const inicio = texto.indexOf('{');
  if (inicio === -1) return {};
  const fim = texto.indexOf('}', inicio);
  if (fim === -1) return {};

  let bruto;
  try {
    bruto = JSON.parse(texto.slice(inicio, fim + 1));
  } catch {
    return {};
  }
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {};

  const resultado = {};
  for (const [chaveBruta, quantidade] of Object.entries(bruto)) {
    const numero = Number(String(chaveBruta).replace(/^R\$\s*/i, '').replace(',', '.'));
    if (!Number.isFinite(numero)) continue;

    const chave = String(numero);
    if (!DENOMINACOES.includes(chave)) continue;
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_QUANTIDADE) continue;

    resultado[chave] = quantidade;
  }
  return resultado;
}
