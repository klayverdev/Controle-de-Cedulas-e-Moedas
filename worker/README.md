# Worker de leitura por foto

Recebe uma foto de cédulas e moedas e devolve as quantidades por valor, usando o Workers AI da Cloudflare.
O desenho completo está em `docs/superpowers/specs/2026-10-30-leitura-por-foto-design.md`.

## Custo

Nenhum, desde que você fique no plano **Workers Free**. O Workers AI inclui 10.000 Neurons por dia. Ao passar disso, as chamadas **falham com erro** (o app mostra "o limite gratuito de hoje acabou") e voltam no dia seguinte. A cobrança só existe se você mesmo migrar para o plano pago.

## Publicar

Requisitos: Node 18 ou mais novo e uma conta gratuita da Cloudflare.

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

O último comando mostra o endereço da Worker, algo como `https://leitura-cedulas.SEU-USUARIO.workers.dev`.

1. **Permitir o seu app.** Em `wrangler.toml`, acrescente o endereço onde o app está publicado em `ALLOWED_ORIGIN` (separados por vírgula, sem barra no final) e publique de novo. Sem isso a Worker responde 403 ao app.
2. **Informar o endereço no app.** Em `leitura-foto.js`, preencha `PHOTO_WORKER_URL` com o endereço da Worker.

Se a primeira chamada devolver um erro pedindo para aceitar os termos de uso do modelo Llama, siga a mensagem do erro. O app mostrará "o serviço de leitura falhou" enquanto isso não for feito.

## Testar a precisão antes de usar

Reúna de 8 a 10 fotos JPG (até 1,5 MB cada) em condições diferentes: luz boa e ruim, notas sobrepostas, moedas misturadas. Crie um `gabarito.json` com o que realmente há em cada uma:

```json
{ "foto1.jpg": { "50": 2, "0.5": 3 }, "foto2.jpg": { "20": 1, "1": 4 } }
```

Depois rode:

```bash
node teste-precisao.mjs ./minhas-fotos ./gabarito.json https://leitura-cedulas.SEU-USUARIO.workers.dev
```

O script mostra o acerto por foto e por valor. O recurso vale a pena se o total sair certo em pelo menos 8 de 10 fotos. Se não chegar nisso, o modelo precisa ser reavaliado (por exemplo, trocar por outro) antes de confiar nos números.

## Testes automáticos

```bash
cd worker
npm test
```

Cobrem a validação da resposta do modelo e o comportamento da Worker (origem, tamanho, erros e sucesso) com o modelo simulado. Eles **não** medem a precisão do modelo real; isso é o teste acima.

## Privacidade

A Worker não guarda nem registra as fotos. Mesmo assim, a imagem é processada pelo Workers AI da Cloudflare, então não envie fotos que não possam sair do seu computador.
