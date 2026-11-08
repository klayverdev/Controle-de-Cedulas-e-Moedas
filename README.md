# Contador de Caixa

Ferramenta simples para conferência de caixa. Você conta as cédulas e moedas, registra se foi entrada ou retirada, e o sistema mantém o saldo e o histórico de tudo o que foi lançado.

Nasceu de uma necessidade prática: fechar caixa contando dinheiro físico, com histórico organizado, sem depender de planilha. A contagem manual funciona sem internet; a leitura por foto (opcional) precisa dela.

![Tela principal do Contador de Caixa](media/tela-principal.png)

---

## Demonstração

Contando cédulas com os atalhos de quantidade, salvando uma entrada, depois uma retirada, e abrindo o detalhamento de uma operação no histórico:

![Demonstração de uso do Contador de Caixa](media/demo.gif)

Se preferir o vídeo em melhor qualidade, o arquivo está em [`media/demo.mp4`](media/demo.mp4).

---

## Como usar

1. Abra o `index.html` em qualquer navegador. Não precisa instalar nada.
2. Informe a quantidade de cada nota e moeda, digitando no campo ou usando os atalhos `+1` `+5` `+10` `+20`.
3. Clique em **Salvar entrada** (dinheiro entrando no caixa) ou **Salvar retirada** (dinheiro saindo).
4. O histórico, à direita, registra cada lançamento. Clique no ícone de engrenagem em qualquer item para ver o detalhamento por cédula e moeda.
5. Se precisar conferir rapidamente quanto tem no caixa agora, clique no ícone de engrenagem ao lado do total, no rodapé.
6. Já tem uma contagem pronta anotada em outro lugar? Cole em **Importar contagem**, uma linha por denominação, no formato abaixo.

```
3x R$ 50.00
10x R$ 5.00
25x R$ 0.25
```

### Saldo detalhado

Clicando na engrenagem ao lado do total geral, dá pra ver exatamente quantas cédulas e moedas de cada valor compõem o saldo atual:

![Detalhamento do saldo atual, separado por notas e moedas](media/saldo-detalhado.png)

### Recuperando um lançamento apagado

Apagar uma operação não a remove de verdade. Ela vai para uma lixeira, acessível pelo ícone ao lado de "Histórico de operações", de onde pode ser restaurada a qualquer momento:

![Modal de operações apagadas com opção de recuperar](media/apagados.png)

---

## Por que foi feito assim

**Sem backend, sem instalação, sem framework.** É só HTML, CSS e JavaScript puro, sem nenhuma dependência (a única coisa que vem de fora é a fonte Inter, do Google Fonts). Basta abrir o `index.html` em qualquer computador e já funciona. Para contar dinheiro e guardar um histórico durante o expediente, React, Vue ou qualquer ferramenta desse porte seria complexidade que o problema simplesmente não pede. Menos peças significam menos coisa pra quebrar.

**Atalhos de quantidade em vez de só digitar.** Na correria de um caixa, clicar é mais rápido e menos sujeito a erro do que digitar número em teclado numérico de celular. Contar 20 notas de R$10 é dois cliques em "+10", não quatro toques pra digitar "20".

**Importação por texto como atalho, não substituto.** Se a contagem já está anotada em algum lugar (bloco de notas, mensagem, planilha), colar um texto no formato `3x R$ 50.00` é mais rápido do que preencher tudo de novo campo a campo. Os dois jeitos convivem.

**Apagar não apaga de verdade.** Erro de digitação acontece. Em vez de simplesmente sumir com um lançamento, a operação apagada vai para uma lixeira, de onde pode ser recuperada, exatamente como a lixeira do sistema operacional. Nada se perde por descuido.

**Paleta quase toda em preto, branco e cinza.** Cor tem custo cognitivo: quanto mais cores na tela, mais o olho precisa decidir onde prestar atenção. Aqui, verde e vermelho aparecem só onde têm significado real (entrada e saída de dinheiro), então realmente chamam atenção quando importam.

---

## Estrutura do projeto

```
contador-de-caixa/
├── index.html            → estrutura da página
├── style.css             → aparência (cores, layout, responsividade)
├── script.js             → lógica: cálculos, histórico, modal, importação
├── leitura-foto.js       → botão "Enviar foto": junta a contagem de moedas e a leitura de cédulas
├── contagem-moedas.js    → conta e classifica as moedas da foto (OpenCV.js, roda no navegador)
├── contagem-moedas.test.cjs  → testes da contagem, com fotos reais em test-fotos/
├── worker/               → Worker da Cloudflare que lê as cédulas por IA (tem README próprio)
├── test-fotos/           → fotos reais de moedas usadas nos testes
├── docs/                 → documento de desenho da leitura por foto
└── media/                → screenshots e vídeo de demonstração
```

Os arquivos de código são separados de propósito. Mesmo sendo um projeto pequeno, misturar estrutura, estilo e comportamento no mesmo arquivo dificulta manutenção mais adiante. Ao mesmo tempo, não há necessidade de complicar isso com um bundler ou processo de build; a separação em arquivos já resolve.

---

## Leitura por foto

O botão **Enviar foto** preenche os campos de quantidade a partir de uma imagem escolhida como arquivo. **Ele só preenche os campos.** Quem confere e salva a entrada ou a retirada é você. Se já houver quantidades digitadas, o app pergunta antes de substituí-las.

### Como funciona

- **Moedas** são contadas no próprio aparelho, sem custo (`contagem-moedas.js`):
  1. o OpenCV.js acha os círculos da foto;
  2. a cor do centro e da borda de cada um separa prateada (R$ 0,50), bicolor (R$ 1), cobre (R$ 0,05) e dourada (R$ 0,10 ou R$ 0,25);
  3. o tamanho separa R$ 0,10 de R$ 0,25, usando a moeda de R$ 1 como régua quando ela aparece;
  4. as moedas ficam em montes, um por valor: uma moeda que encosta em outras assume o valor do monte onde está, e uma solta vai para o monte mais próximo.
  O OpenCV.js (cerca de 8 MB, do jsDelivr) só é baixado quando você envia a primeira foto.
- **Cédulas** são lidas por IA, na Worker da pasta `worker/` (Cloudflare Workers AI, plano gratuito). Veja `worker/README.md`.
- Se a contagem local de moedas falhar, a IA lê tudo, como na primeira versão.

### Para a foto sair certa

- Foto de cima, com foco, luz clara e sem reflexo forte.
- Moedas **espalhadas, sem empilhar** (a que está embaixo não é vista).
- **Um monte para cada valor**, com os montes separados entre si. É essa separação que faz a leitura acertar as moedas que a cor e o tamanho não distinguem (por exemplo, moedas prateadas antigas de R$ 0,25 e R$ 0,05).
- Cédulas espalhadas, sem uma cobrir a outra.

### O que foi testado

- **Moedas:** duas fotos reais, de celulares e luzes diferentes, com cerca de 113 moedas cada. A contagem bateu com a conferida moeda a moeda. Os testes automáticos exigem esses números exatos.
- **Cédulas:** ainda **não** foram medidas com fotos reais. Antes de confiar nelas, rode `worker/teste-precisao.mjs` com fotos suas e a contagem real (veja `worker/README.md`).

### Limites conhecidos da leitura por foto

- Uma moeda prateada sozinha, longe de qualquer monte, é contada como R$ 0,50, mesmo que seja de outro valor. Só o número gravado diferenciaria.
- Moedas tortas, muito borradas ou a menos de uns 900 px de largura na foto podem ser perdidas.
- O resultado vale só para as fotos testadas; com outra luz ou câmera pode errar uma ou outra moeda. Por isso, confira sempre os campos antes de salvar.

### Custo e privacidade

Sem custo: a contagem de moedas roda no seu aparelho, e as cédulas usam a cota gratuita da Cloudflare (10.000 Neurons por dia; passando disso a leitura falha e volta no dia seguinte, sem cobrança). A foto enviada para a leitura de cédulas é processada pela Cloudflare e não é guardada pela Worker.

### Testes

```bash
npm install   # só instala as ferramentas de teste
npm test      # testes da contagem de moedas, incluindo as fotos reais
cd worker && npm test   # testes da Worker
```

---

## Limitações conhecidas

- **Os dados existem só enquanto a aba está aberta.** Recarregar a página ou fechar o navegador reinicia tudo, inclusive o histórico e a lixeira de apagados.
- **Uso local, um caixa por vez.** Não há login, nem separação entre usuários ou dispositivos.
- **A importação de texto segue um formato fixo** (`Nx R$ valor`, uma denominação por linha). Textos em outros formatos não são reconhecidos.

## Próximos passos, se for evoluir

- Persistir os dados no navegador (`localStorage`) para sobreviver a um F5, ou um backend simples se precisar acessar de mais de um dispositivo.
- Exportar o histórico do dia em CSV ou PDF, para juntar ao fechamento de caixa.
- Medir a leitura de cédulas por foto com fotos reais e, se precisar, trocar o modelo ou o método.
- Filtro de histórico por data, já que hoje tudo fica em uma lista só, sem separação por dia.

Nada disso foi feito ainda porque a prioridade da primeira versão era ter algo funcional para contar caixa. O resto se adiciona conforme o uso real pedir.
