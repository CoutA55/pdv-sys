# PDV para mercadinho

Sistema local de ponto de venda. O servidor usa Node.js, Express e SQLite; valores monetários são inteiros em centavos e as quantidades são inteiros em milésimos.

## Servidor

```sh
cd server
npm install
npm run migrar
npm run testar-banco
npm run testar-api
npm start
```

O servidor escuta em `127.0.0.1:3000`. Para escolher outra porta, defina `PORT`; para escolher o arquivo SQLite, defina `PDV_DB`.

## Interface web

Com o servidor iniciado, em outro terminal:

```sh
cd web
npm install
npm run dev
```

Abra o endereço informado pelo Vite (normalmente `http://localhost:5173`). Durante o desenvolvimento, as chamadas `/api` são encaminhadas ao servidor local em `127.0.0.1:3000`. A interface inclui visão geral, frente de caixa, produtos/estoque, faturamento e relatório de fiado. O menu lateral permite alternar entre modo claro e escuro, e a preferência fica salva neste navegador. No pagamento, é possível combinar formas de pagamento e cadastrar ou selecionar um cliente para lançar fiado. Na tela de abertura do caixa, selecione um operador existente ou use **Cadastrar operador** para adicionar outro informando apenas o nome; se ainda não houver operadores cadastrados, informe o nome e abra o caixa.

Para gerar os arquivos otimizados da interface, rode `npm run build` dentro de `web`.

## Backup

Em **Backup**, escolha um dispositivo montado, como um pendrive, e salve o destino. O sistema grava as cópias na pasta `PDV-Backups` do dispositivo escolhido; também é possível usar **Criar backup agora**. Com o destino configurado e conectado, o servidor tenta criar um backup diário e mantém até 30 cópias. Se o dispositivo estiver desconectado, o sistema não grava no disco interno como alternativa; a tela informa a desconexão e permite tentar novamente após reconectar.

As cópias são feitas pelo mecanismo online do SQLite e passam por uma verificação de integridade antes de serem mantidas. A configuração do dispositivo fica em `server/data` junto aos dados locais, e arquivos de banco não devem ser adicionados ao Git. O backup no pendrive não protege contra perda ou dano simultâneo do computador e do dispositivo; mantenha outra cópia em local separado.

Para validar o mecanismo de cópia SQLite, rode `npm run testar-backup` dentro de `server`.

## Fluxo de caixa e venda

- `POST /api/caixa/abrir` com `usuario_id`, `valor_abertura_centavos` (opcional, padrão `0`) e `observacao` (opcional).
- `GET /api/caixa/aberto` consulta o caixa atual e o saldo esperado em dinheiro.
- `POST /api/vendas` recebe `sessao_id`, `itens` (`produto_id`, `quantidade_milesimos` e desconto opcional), `pagamentos` (`forma`, `valor_centavos` e troco opcional para dinheiro), além de desconto geral e `cliente_id` opcionais.
- `POST /api/caixa/movimentacoes` registra `SANGRIA` ou `SUPRIMENTO`, com `valor_centavos` e `motivo` obrigatórios, apenas com o caixa aberto. Sangria não pode exceder o saldo esperado.
- `POST /api/caixa/fechar` recebe `valor_contado_centavos` e `observacao` opcional; a resposta informa saldo esperado e diferença.

As vendas validam estoque, somam os pagamentos e gravam venda, itens, pagamentos, baixa de estoque e eventual débito de fiado dentro de uma única transação. O fiado não tem limite automático: os lançamentos registram a dívida de cada cliente para controle e cobrança.
Em **Caixa**, sangrias e suprimentos ficam ao lado de **Fechar caixa** e atualizam o dinheiro esperado na gaveta.

Na frente de caixa, use `↑`/`↓` para percorrer sugestões e itens da venda, `Enter` para editar a quantidade, `+`/`−` para ajustar uma unidade ou fração, `Delete` para remover o item selecionado e digite uma letra para voltar à busca. `F1` busca produto, `F3` abre o pagamento, `F4` consulta preço, `F8` limpa a venda e `F10` fecha o caixa. Na tela de pagamento, as setas percorrem os controles; `→` no campo de valor preenche o que falta pagar. No seletor de cliente fiado, `Enter` ou `Espaço` abre e confirma a opção destacada, e as setas percorrem clientes quando a lista está aberta. Ao cadastrar um cliente para o fiado, use **Voltar para clientes** ou `Esc` para sair do cadastro sem fechar o pagamento.

Na tela **Estoque**, use **Entrada** ao receber mercadoria: informe quantidade, custo unitário opcional e observação. A operação cria uma movimentação de entrada; não edite o saldo manualmente. O custo cadastrado pode ser atualizado opcionalmente durante o registro. A tela também oferece ajuste por contagem física ou perda, histórico de movimentações por produto, patrimônio estimado a custo, faturamento e lucro bruto potenciais. Essas estimativas usam os custos e preços cadastrados e não descontam despesas, impostos ou perdas futuras. As rotas correspondentes são `GET /api/estoque/resumo`, `POST /api/estoque/ajuste` e `GET /api/estoque/movimentacoes`.

## Relatórios

A organização prevista do PDV é **Caixa**, **Estoque** e **Relatórios**. Dentro de Relatórios, `GET /api/relatorios/fiado` retorna o total atual a receber, os clientes com saldo devedor e as vendas pagas total ou parcialmente no fiado. O relatório também diferencia o total histórico vendido no fiado do saldo devedor atual, que considera os pagamentos já registrados. A lista de vendas pode ser limitada com `?limite=100` (máximo de 200).

`GET /api/relatorios/faturamento?de=AAAA-MM-DD&ate=AAAA-MM-DD` retorna o resumo, a comparação com o período anterior, a série diária ou mensal, as formas de pagamento e os produtos com maior faturamento. As datas são opcionais (padrão: mês atual até hoje); `agrupar=dia` ou `agrupar=mes` controla a série. Para o fiado, `GET /api/clientes` lista clientes ativos e desbloqueados e `POST /api/clientes` cadastra um cliente com `nome` obrigatório e `telefone` opcional. `GET /api/clientes/todos` lista clientes de qualquer situação para consulta de histórico, e `GET /api/clientes/:id/extrato` retorna o extrato individual paginado com saldo após cada lançamento. Em **Relatórios → Fiado**, consulte o extrato de qualquer cliente, inclusive sem dívida atual ou inativo, e registre pagamentos parciais ou totais; é necessário estar com o caixa aberto. O recebimento é gravado como crédito imutável no livro-razão e recebimentos em dinheiro entram no saldo esperado do caixa.
`GET /api/vendas/historico?de=AAAA-MM-DD&ate=AAAA-MM-DD&limite=100` consulta vendas e seus itens/pagamentos (padrão: últimos 30 dias; máximo de 200). Em **Relatórios → Vendas**, `POST /api/vendas/:id/devolver-item` registra devolução parcial com `venda_item_id`, `quantidade_milesimos`, `destino` (`ESTOQUE` ou `DESCARTE`) e `motivo`; exige venda concluída e caixa aberto. A devolução parcial de vendas com desconto ainda não é permitida. O valor é distribuído proporcionalmente entre as formas originais de pagamento; o fiado reduz a dívida e, se já quitado, a parte correspondente é devolvida em dinheiro. Produtos descartados são registrados no livro-razão sem aumentar o estoque vendável. `POST /api/vendas/:id/cancelar` continua cancelando o restante da venda, estornando somente quantidades e pagamentos ainda não devolvidos. As operações são transacionais e os lançamentos originais permanecem imutáveis.
