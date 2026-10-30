# Leitura de cédulas e moedas por foto — desenho

Data: 2026-10-30
Projeto: Controle de Cédulas e Moedas (HTML, CSS e JavaScript puro)

## Objetivo

O usuário escolhe um arquivo de foto com cédulas e moedas. O app identifica as denominações e as quantidades e preenche os campos de quantidade. O usuário confere os números e salva como entrada ou retirada, usando os botões que já existem. Saldo, histórico e lixeira não mudam.

## Restrições decididas

- **Custo zero, literalmente.** Nada pode gerar cobrança. A solução usa apenas o plano Workers Free da Cloudflare. Segundo a página de preços do Workers AI, ao passar da alocação diária gratuita (10.000 Neurons por dia) as operações falham com erro. Não há cobrança, a não ser que o usuário migre para o plano pago.
- **Sem framework e sem etapa de build** no app, como hoje.
- **Entrada por seletor de arquivo.** `<input type="file" accept="image/*">` sem o atributo `capture`. No celular o sistema oferece galeria, arquivos ou câmera. No computador abre o seletor normal.
- **A foto nunca grava nada sozinha.** Ela só preenche os campos. O modelo pode errar, então a confirmação é humana.

## Fora de escopo

Persistência dos dados, abrir a câmera diretamente, arrastar e soltar, guardar as fotos, recorte ou edição da imagem, uso da API do Gemini (só se o teste de precisão reprovar a opção atual) e qualquer mudança no cálculo de saldo.

## Arquitetura

Três partes, cada uma com uma função clara.

1. **Worker** (`worker/index.js`, `worker/wrangler.toml`): recebe a imagem, chama o Workers AI, valida a resposta e devolve as quantidades. A chamada usa o acesso `AI` configurado no `wrangler.toml`, então não existe chave de API.
2. **Validação** (`worker/validar.js`): função pura que transforma o texto do modelo em quantidades válidas. Fica separada para ser testada sem rede.
3. **Cliente** (`leitura-foto.js`, carregado depois do `script.js`): reduz a imagem, chama a Worker, mostra o estado e preenche os campos. Reaproveita o `DENOMINATIONS` e os campos `.denomination__input` que já existem. O `script.js` não muda.

Alterações pequenas em `index.html` (botão "Enviar foto", campo de arquivo escondido e uma linha de status) e em `style.css`.

## Fluxo

1. O usuário toca em "Enviar foto" e escolhe um arquivo.
2. O cliente decodifica a imagem respeitando a orientação do arquivo, reduz o maior lado para 1024 px e gera um JPEG com qualidade 0,85. Isso poupa o limite diário e acelera a resposta.
3. O cliente envia `POST` para a Worker, com o JPEG como corpo (`Content-Type: image/jpeg`).
4. A Worker confere origem e tamanho, envia a imagem ao modelo `@cf/meta/llama-3.2-11b-vision-instruct` com temperatura 0 e valida a resposta.
5. O cliente recebe as quantidades. Se já houver algum campo maior que zero, pergunta com `confirm` se pode substituir as quantidades digitadas. Depois preenche todos os campos (os não retornados ficam em 0) e mostra "Campos preenchidos pela foto. Confira antes de salvar."

## Contrato da Worker

Requisição: `POST /reconhecer`, corpo binário JPEG, no máximo 1,5 MB. Como o envio é entre endereços diferentes, o navegador faz antes uma checagem `OPTIONS`. A Worker responde a ela com os cabeçalhos CORS permitindo apenas o `ALLOWED_ORIGIN`, o método `POST` e o cabeçalho `Content-Type`.

Resposta de sucesso (200):

```json
{ "quantidades": { "50": 2, "0.5": 3 } }
```

As chaves são texto e só podem ser: `200`, `100`, `50`, `20`, `10`, `5`, `2`, `1`, `0.5`, `0.25`, `0.1`, `0.05`.

| Código | Quando | Mensagem mostrada ao usuário |
|---|---|---|
| 400 | corpo vazio, grande demais ou que não é JPEG | "Imagem inválida ou grande demais." |
| 403 | origem não permitida | "Este endereço não tem permissão para ler fotos." |
| 422 | o modelo respondeu algo sem nenhuma quantidade válida | "Não consegui ler a foto. Tente outra." |
| 429 | limite gratuito do dia atingido | "O limite gratuito de hoje acabou. Use a contagem manual." |
| 502 | falha ao chamar o modelo | "O serviço de leitura falhou. Tente de novo." |

Em qualquer erro, nenhum campo é alterado.

## Prompt e validação

O prompt pede, em português, uma resposta composta somente por um objeto JSON com as 12 denominações como chaves e a quantidade inteira visível de cada uma, com 0 quando não houver. Pede também para não contar itens cortados ou duvidosos.

A validação extrai o primeiro objeto JSON do texto e descarta o que não serve:

- chaves fora das 12 permitidas;
- valores que não sejam inteiros entre 0 e 200;
- entradas zeradas.

Se nada sobrar, o resultado é o erro 422.

## Proteções

- A Worker só responde a pedidos cujo cabeçalho `Origin` seja o endereço do app, definido na variável `ALLOWED_ORIGIN` do `wrangler.toml`. O endereço de produção será informado pelo usuário antes da publicação. Em desenvolvimento vale também `http://localhost:8080`. Esse cabeçalho pode ser forjado por quem usa ferramentas fora do navegador, então a proteção reduz o risco de gasto indevido do limite diário, mas não o elimina. O pior efeito possível é o recurso parar por um dia.
- Limite de 1,5 MB por foto.
- A Worker não guarda nem registra as fotos.
- A foto é processada pelo Workers AI da Cloudflare. Não enviar imagens com informações que não possam sair do computador.

## Testes

1. **Validação (automático):** testes com `node --test` sobre `worker/validar.js`, cobrindo resposta correta, texto ao redor do JSON, chave inválida, valor negativo, valor decimal, valor acima do teto e resposta vazia.
2. **Precisão (manual, antes de integrar o cliente):** o script `worker/teste-precisao.mjs` envia uma pasta de fotos reais à Worker publicada, compara com um `gabarito.json` feito pelo usuário e imprime o acerto por denominação e o acerto do total. Usar de 8 a 10 fotos em condições variadas: boa e má iluminação, notas sobrepostas, moedas misturadas.
3. **Critério de decisão:** o recurso segue se o total sair certo em pelo menos 8 de 10 fotos. Se não chegar nisso, a decisão volta ao usuário: tentar a opção com Gemini, ou desistir. O cliente só é integrado depois dessa etapa.
4. **Cliente:** verificação manual dos cenários de sucesso, de cada erro da tabela acima e da substituição de campos já preenchidos.

## Entrega

A sessão tem acesso apenas de leitura ao repositório. Os arquivos são escritos e testados aqui e entregues prontos. O usuário copia para o projeto, faz o commit e publica a Worker com `wrangler deploy`, na própria conta gratuita da Cloudflare.

## Riscos

- **Precisão do modelo** em notas sobrepostas e em moedas. É o motivo do teste manual antes da integração.
- **Limite diário.** A estimativa é de algumas centenas de fotos por dia, sujeita ao número real de tokens que cada imagem gera. Será medida no teste de precisão.
- **Disponibilidade do modelo.** O Workers AI pode exigir aceitar os termos de uso do modelo na primeira chamada e pode mudar a lista de modelos. Isso será verificado na publicação.
