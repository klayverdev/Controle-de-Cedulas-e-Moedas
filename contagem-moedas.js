'use strict';

/* ------------------------------------------------------------------------ *
 * Contagem de moedas por visão computacional (roda no navegador, de graça)
 *
 * 1. acha os círculos da foto (transformada de Hough, OpenCV.js);
 * 2. mede a cor do centro e da borda de cada um;
 * 3. decide o valor pela cor e pelo tamanho, usando a moeda de R$ 1 (a única
 *    bicolor) como régua quando ela aparece na foto.
 *
 * classificarMoedas() é pura e testável sem navegador.
 * ------------------------------------------------------------------------ */
(function (raiz) {
  // Endereço do OpenCV.js. Pode ser trocado definindo window.OPENCV_URL antes (vazio = desligado).
  const OPENCV_URL_PADRAO = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';

  const LADO_MAX_ANALISE = 1600; // px do lado maior usado na análise
  const DIF_BICOLOR = 30; // borda tão mais saturada que o centro (0-255) = moeda de R$ 1 (dourada por fora, prateada por dentro)
  const SAT_BORDA_PRATA = 65; // borda com saturação (0-255) abaixo disso = metal prateado
  const MATIZ_COBRE_MAX = 14.5; // matiz (0-179) até aqui = cor de cobre (R$ 0,05)
  const CORTE_TAMANHO = 0.78; // fração do raio da moeda de R$ 1 que separa "pequena" de "grande"
  const MIOLO_MAX = 0.70; // prateada com raio abaixo dessa fração do raio da R$ 1 = miolo de uma R$ 1
  const RAIO_R1_RELATIVO = 0.0276; // raio da moeda de R$ 1 / lado maior, se não houver R$ 1 na foto

  function mediana(valores) {
    const ordenados = valores.slice().sort((a, b) => a - b);
    const meio = ordenados.length >> 1;
    return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
  }

  /**
   * circulos: [{ r, satCentro, satBorda, matizBorda }] (cores no padrão do OpenCV: H 0-179, S 0-255).
   * ladoMaior: lado maior da imagem analisada, em px (só usado se não houver moeda de R$ 1).
   * Devolve { quantidades: { '1': n, '0.5': n, ... }, referencia: raio usado como régua }.
   */
  function classificarMoedas(circulos, ladoMaior) {
    const tipos = circulos.map((c) => {
      if (c.satBorda - c.satCentro > DIF_BICOLOR) return 'bicolor';
      if (c.satBorda < SAT_BORDA_PRATA) return 'prata';
      return c.matizBorda <= MATIZ_COBRE_MAX ? 'cobre' : 'dourada';
    });

    const raiosR1 = circulos.filter((_, i) => tipos[i] === 'bicolor').map((c) => c.r);
    const referencia = raiosR1.length ? mediana(raiosR1) : RAIO_R1_RELATIVO * ladoMaior;
    const corte = referencia * CORTE_TAMANHO;

    // O raio medido de cada moeda tem ruído; moedas vizinhas costumam ser do mesmo tipo.
    // Para as douradas, usa-se o raio mediano das douradas ao redor (a própria inclusa).
    const raioSuavizado = (c, i) => {
      if (c.x === undefined) return c.r;
      const raios = circulos
        .filter((o, j) => tipos[j] === 'dourada' && (j === i || Math.hypot(c.x - o.x, c.y - o.y) <= c.r * 2.4))
        .map((o) => o.r);
      return mediana(raios);
    };

    const valores = circulos.map((c, i) => {
      const grande = raioSuavizado(c, i) >= corte;
      if (tipos[i] === 'bicolor') return 1;
      if (tipos[i] === 'cobre') return 0.05;
      if (tipos[i] === 'dourada') return grande ? 0.25 : 0.1;
      if (tipos[i] === 'prata') return 0.5;
      return null;
    });

    // Miolo prateado de uma R$ 1 cujo contorno externo não foi achado: círculo prateado bem menor
    // que qualquer moeda real. Só dá para saber com a régua de uma R$ 1 na foto.
    const fixas = tipos.map((t) => t === 'bicolor');
    if (raiosR1.length) {
      circulos.forEach((c, i) => {
        if (tipos[i] === 'prata' && c.r < referencia * MIOLO_MAX) {
          valores[i] = 1;
          fixas[i] = true;
        }
      });
    }

    // As moedas ficam em montes, e cada monte tem um só valor. Uma moeda cercada por moedas de
    // outro valor (uma cobre mais clara, uma prateada de série antiga, uma enferrujada) assume
    // o valor do monte onde está. Repete algumas vezes para o valor se espalhar pelo monte.
    if (circulos.every((c) => c.x !== undefined)) {
      const perto = (i, fator) =>
        circulos
          .map((_, j) => j)
          .filter((j) => j !== i && Math.hypot(circulos[i].x - circulos[j].x, circulos[i].y - circulos[j].y) <= (circulos[i].r + circulos[j].r) * fator);
      // Moedas que se tocam são do mesmo monte: quem encosta em ao menos duas vota só com elas.
      // Se não, vale quem está quase encostando; se ainda não, procura o monte mais perto.
      const vizinhas = circulos.map((_, i) => {
        for (const fator of [1.12, 1.4]) {
          const achadas = perto(i, fator);
          if (achadas.length >= 2) return achadas;
        }
        return perto(i, 2.1);
      });
      const iniciais = valores.slice();
      for (let rodada = 0; rodada < 3; rodada += 1) {
        const atuais = valores.slice();
        circulos.forEach((_, i) => {
          if (fixas[i] || vizinhas[i].length < 1) return;
          const votos = {};
          vizinhas[i].forEach((j) => { votos[atuais[j]] = (votos[atuais[j]] || 0) + 1; });
          const [melhor, quantos] = Object.entries(votos).sort((x, y) => y[1] - x[1])[0];
          if (quantos / vizinhas[i].length < 0.6) return;
          const novoValor = Number(melhor);
          // O tamanho de uma moeda dourada é confiável: a vizinhança não a troca entre R$ 0,10 e
          // R$ 0,25. Só corrige confusão de cor (cobre clara, prateada enferrujada) ou de prata (sem pista própria).
          if (tipos[i] === 'dourada' && novoValor !== 0.05 && novoValor !== 0.5 && novoValor !== iniciais[i]) return;
          valores[i] = novoValor;
        });
      }
    }

    const quantidades = { 1: 0, 0.5: 0, 0.25: 0, 0.1: 0, 0.05: 0 };
    valores.forEach((v) => { quantidades[v] += 1; });
    return { quantidades, referencia, valores };
  }

  // O Hough às vezes acha um círculo falso dentro de uma moeda (o miolo prateado da de R$ 1, por
  // exemplo). Descarta quem tem o centro bem dentro de outro círculo maior.
  function removerContidos(circulos) {
    return circulos.filter(
      (c) => !circulos.some((o) => o !== c && o.r > c.r && Math.hypot(o.x - c.x, o.y - c.y) < o.r * 0.6),
    );
  }

  // ---- Visão computacional (precisa do OpenCV.js) ---------------------------------

  let promessaOpenCV = null;

  function carregarOpenCV(documento) {
    const url = typeof raiz.OPENCV_URL === 'string' ? raiz.OPENCV_URL : OPENCV_URL_PADRAO;
    if (!url) return Promise.reject(new Error('OpenCV desligado.'));
    if (promessaOpenCV) return promessaOpenCV;

    promessaOpenCV = new Promise((resolve, reject) => {
      // Atenção: o objeto `cv` de algumas versões tem um método `then` que devolve ele mesmo.
      // Entregá-lo direto a resolve() ou a await trava a página num laço infinito; por isso
      // ele sempre sai embrulhado em { cv }.
      const pronto = () => {
        const cv = raiz.cv;
        if (cv && cv.Mat) return resolve({ cv });
        if (cv instanceof Promise) return cv.then((pronto2) => resolve({ cv: pronto2 }), reject);
        if (cv) cv.onRuntimeInitialized = () => resolve({ cv });
        else reject(new Error('OpenCV não iniciou.'));
      };
      if (raiz.cv) return pronto();
      const script = documento.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = pronto;
      script.onerror = () => reject(new Error('Não consegui carregar o OpenCV.'));
      documento.head.appendChild(script);
    }).catch((erro) => {
      promessaOpenCV = null; // permite tentar de novo
      throw erro;
    });
    return promessaOpenCV;
  }

  function medianaCanal(hsv, largura, altura, cx, cy, rMin, rMax, canal) {
    const valores = [];
    const x0 = Math.max(0, Math.floor(cx - rMax));
    const x1 = Math.min(largura - 1, Math.ceil(cx + rMax));
    const y0 = Math.max(0, Math.floor(cy - rMax));
    const y1 = Math.min(altura - 1, Math.ceil(cy + rMax));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x - cx, y - cy);
        if (d >= rMin && d <= rMax) valores.push(hsv[(y * largura + x) * 3 + canal]);
      }
    }
    return valores.length ? mediana(valores) : 0;
  }

  function hough(cv, cinza, minR, maxR, minDist) {
    const saida = new cv.Mat();
    cv.HoughCircles(cinza, saida, cv.HOUGH_GRADIENT, 1.2, minDist, 100, 28, minR, maxR);
    const lista = [];
    for (let i = 0; i < saida.cols; i += 1) {
      lista.push({ x: saida.data32F[i * 3], y: saida.data32F[i * 3 + 1], r: saida.data32F[i * 3 + 2] });
    }
    saida.delete();
    return lista;
  }

  /** imageData: { data (RGBA), width, height }. Devolve a lista de círculos já com as cores medidas. */
  function detectarCirculos(cv, imageData) {
    const { width: largura, height: altura } = imageData;
    const ladoMaior = Math.max(largura, altura);
    const rgba = cv.matFromImageData(imageData);
    const rgb = new cv.Mat();
    const cinza = new cv.Mat();
    const hsvMat = new cv.Mat();
    try {
      cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, cinza, cv.COLOR_RGB2GRAY);
      cv.cvtColor(rgb, hsvMat, cv.COLOR_RGB2HSV);
      cv.GaussianBlur(cinza, cinza, new cv.Size(9, 9), 2);

      // 1ª passada, com tamanhos bem abertos, só para descobrir o tamanho típico de uma moeda.
      const largos = hough(cv, cinza, Math.round(0.012 * ladoMaior), Math.round(0.045 * ladoMaior), Math.round(0.02 * ladoMaior));
      if (largos.length === 0) return [];
      const tipico = mediana(largos.map((c) => c.r));

      // 2ª passada, já na faixa de tamanhos certa para essa foto.
      const achados = hough(cv, cinza, Math.round(tipico * 0.7), Math.round(tipico * 1.4), Math.round(tipico * 1.25));

      const hsv = hsvMat.data;
      return removerContidos(achados).map((c) => ({
        x: c.x,
        y: c.y,
        r: c.r,
        satCentro: medianaCanal(hsv, largura, altura, c.x, c.y, 0, c.r * 0.4, 1),
        satBorda: medianaCanal(hsv, largura, altura, c.x, c.y, c.r * 0.7, c.r * 0.92, 1),
        matizBorda: medianaCanal(hsv, largura, altura, c.x, c.y, c.r * 0.7, c.r * 0.92, 0),
      }));
    } finally {
      [rgba, rgb, cinza, hsvMat].forEach((m) => m.delete());
    }
  }

  /** Conta as moedas de uma imagem já desenhada (ImageData). Devolve { quantidades, total, circulos }. */
  function contarMoedasDaImagem(cv, imageData) {
    const circulos = detectarCirculos(cv, imageData);
    const { quantidades, valores } = classificarMoedas(circulos, Math.max(imageData.width, imageData.height));
    return { quantidades, total: circulos.length, circulos, valores };
  }

  /**
   * No navegador: lê o arquivo de imagem, reduz para até 1600 px e conta as moedas.
   * Devolve null quando não achou nenhuma moeda; rejeita se o OpenCV não carregar.
   */
  async function contarMoedasDoArquivo(arquivo, documento) {
    const { cv } = await carregarOpenCV(documento);
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, LADO_MAX_ANALISE / Math.max(bitmap.width, bitmap.height));
    const canvas = documento.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const contexto = canvas.getContext('2d', { willReadFrequently: true });
    contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const resultado = contarMoedasDaImagem(cv, contexto.getImageData(0, 0, canvas.width, canvas.height));
    return resultado.total > 0 ? resultado : null;
  }

  const api = { classificarMoedas, removerContidos, detectarCirculos, contarMoedasDaImagem, contarMoedasDoArquivo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.ContagemMoedas = api;
})(typeof window !== 'undefined' ? window : globalThis);
