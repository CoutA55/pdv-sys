const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { abrirBanco } = require('../db');
const { migrar } = require('../migrate');
const { criarApp } = require('../app');

async function main() {
  const db = abrirBanco(':memory:');
  migrar(db);

  const usuarioId = randomUUID();
  const produtoId = randomUUID();
  const clienteId = randomUUID();
  const outroClienteId = randomUUID();

  db.prepare('INSERT INTO usuarios (id, nome) VALUES (?, ?)').run(usuarioId, 'Operador Teste');
  db.prepare(
    `INSERT INTO produtos (id, nome, preco_venda_centavos)
     VALUES (?, 'Arroz', 1000)`
  ).run(produtoId);
  db.prepare(
    `INSERT INTO movimentacoes_estoque (id, produto_id, tipo, quantidade_milesimos)
     VALUES (?, ?, 'ENTRADA', 10000)`
  ).run(randomUUID(), produtoId);
  db.prepare(
    `INSERT INTO clientes (id, nome)
     VALUES (?, 'Cliente Teste')`
  ).run(clienteId);
  db.prepare(
    `INSERT INTO clientes (id, nome, telefone)
     VALUES (?, 'Outro Cliente', '31999990000')`
  ).run(outroClienteId);

  const servidor = criarApp(db).listen(0, '127.0.0.1');
  await new Promise((resolve) => servidor.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${servidor.address().port}/api`;

  async function requisitar(caminho, corpo, metodo) {
    const resposta = await fetch(`${baseUrl}${caminho}`, {
      method: metodo ?? (corpo === undefined ? 'GET' : 'POST'),
      headers: corpo === undefined ? undefined : { 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const dados = resposta.status === 204 ? null : await resposta.json();
    return { status: resposta.status, dados };
  }

  let total = 0;
  async function teste(nome, fn) {
    await fn();
    total++;
    console.log(`OK  ${nome}`);
  }

  try {
    await teste('edita os dados do produto sem alterar o saldo do estoque', async () => {
      const resposta = await requisitar(`/produtos/${produtoId}`, {
        nome: 'Arroz tipo 1',
        preco_venda_centavos: 1200,
        estoque_minimo_milesimos: 2000,
      }, 'PATCH');
      assert.equal(resposta.status, 200);
      assert.equal(resposta.dados.nome, 'Arroz tipo 1');
      assert.equal(resposta.dados.preco_venda_centavos, 1200);
      assert.equal(resposta.dados.estoque_milesimos, 10000);
      assert.equal(
        db.prepare('SELECT COUNT(*) AS total FROM movimentacoes_estoque WHERE produto_id = ?').get(produtoId).total,
        1
      );
      db.prepare('UPDATE produtos SET preco_venda_centavos = 1000 WHERE id = ?').run(produtoId);
    });

    await teste('registra entrada de mercadoria como movimentação no livro-razão', async () => {
      const cadastro = await requisitar('/produtos', {
        nome: 'Produto para entrada',
        unidade: 'KG',
        preco_venda_centavos: 2500,
      });
      assert.equal(cadastro.status, 201);

      const entrada = await requisitar('/estoque/entrada', {
        produto_id: cadastro.dados.id,
        quantidade_milesimos: 2500,
        custo_unitario_centavos: 1200,
        atualizar_custo_produto: true,
        observacao: 'Compra do fornecedor',
      });
      assert.equal(entrada.status, 201);
      assert.equal(entrada.dados.estoque_milesimos, 2500);
      assert.equal(
        db.prepare('SELECT preco_custo_centavos FROM produtos WHERE id = ?').get(cadastro.dados.id).preco_custo_centavos,
        1200
      );
      const movimentacao = db.prepare(
        'SELECT tipo, quantidade_milesimos, custo_unitario_centavos, observacao FROM movimentacoes_estoque WHERE produto_id = ?'
      ).get(cadastro.dados.id);
      assert.deepEqual(movimentacao, {
        tipo: 'ENTRADA',
        quantidade_milesimos: 2500,
        custo_unitario_centavos: 1200,
        observacao: 'Compra do fornecedor',
      });

      const resumo = await requisitar('/estoque/resumo');
      assert.equal(resumo.status, 200);
      assert.equal(resumo.dados.produtos_ativos, 2);
      assert.equal(resumo.dados.valor_estoque_custo_centavos, 3000);
      assert.equal(resumo.dados.faturamento_potencial_centavos, 16250);
      assert.equal(resumo.dados.lucro_bruto_potencial_centavos, 13250);

      const ajuste = await requisitar('/estoque/ajuste', {
        produto_id: cadastro.dados.id,
        saldo_contado_milesimos: 1500,
        observacao: 'Perda por validade',
      });
      assert.equal(ajuste.status, 201);
      assert.equal(ajuste.dados.ajuste_milesimos, -1000);
      assert.equal(ajuste.dados.estoque_milesimos, 1500);

      const historico = await requisitar(`/estoque/movimentacoes?produto_id=${cadastro.dados.id}&limite=10`);
      assert.equal(historico.status, 200);
      assert.equal(historico.dados[0].tipo, 'AJUSTE');
      assert.equal(historico.dados[0].usuario_nome, null);
      assert.equal(historico.dados[0].quantidade_milesimos, -1000);
      assert.equal(historico.dados[0].saldo_apos_milesimos, 1500);
      assert.equal(historico.dados[1].custo_unitario_centavos, 1200);
      assert.equal(historico.dados[1].saldo_apos_milesimos, 2500);

      const unidade = await requisitar('/estoque/entrada', {
        produto_id: produtoId,
        quantidade_milesimos: 1500,
      });
      assert.equal(unidade.status, 400);
      const ajusteUnidadeFracionada = await requisitar('/estoque/ajuste', {
        produto_id: produtoId,
        saldo_contado_milesimos: 9500,
        observacao: 'Contagem com fração inválida',
      });
      assert.equal(ajusteUnidadeFracionada.status, 400);
    });

    await teste('não há caixa aberto inicialmente', async () => {
      const resposta = await requisitar('/caixa/aberto');
      assert.equal(resposta.status, 200);
      assert.equal(resposta.dados.sessao, null);
    });

    await teste('lista operadores ativos para a abertura de caixa', async () => {
      const resposta = await requisitar('/usuarios');
      assert.equal(resposta.status, 200);
      assert.equal(resposta.dados.length, 1);
      assert.equal(resposta.dados[0].id, usuarioId);
    });

    await teste('cadastra um operador local para abrir o caixa', async () => {
      const resposta = await requisitar('/usuarios', { nome: 'Operadora Teste' });
      assert.equal(resposta.status, 201);
      assert.equal(resposta.dados.nome, 'Operadora Teste');
      assert.equal(resposta.dados.papel, 'OPERADOR');
    });

    await teste('lista e cadastra clientes para vendas no fiado', async () => {
      const listagem = await requisitar('/clientes');
      assert.equal(listagem.status, 200);
      assert.equal(listagem.dados.length, 2);

      const cadastro = await requisitar('/clientes', { nome: '  Novo Cliente  ', telefone: '31988887777' });
      assert.equal(cadastro.status, 201);
      assert.equal(cadastro.dados.nome, 'Novo Cliente');
      assert.equal(cadastro.dados.telefone, '31988887777');
      assert.ok(listagem.dados.every((cliente) => cliente.id !== cadastro.dados.id));

      const atualizado = await requisitar('/clientes');
      assert.ok(atualizado.dados.some((cliente) => cliente.id === cadastro.dados.id));
    });

    await teste('lista todos os clientes para consultar extratos sem dívida atual', async () => {
      db.prepare('UPDATE clientes SET ativo = 0, bloqueado = 1 WHERE id = ?').run(outroClienteId);
      const resposta = await requisitar('/clientes/todos');
      assert.equal(resposta.status, 200);
      assert.ok(resposta.dados.some((cliente) => cliente.id === outroClienteId && cliente.ativo === 0));
      assert.ok(resposta.dados.some((cliente) => cliente.nome === 'Novo Cliente' && cliente.saldo_devedor_centavos === 0));
      const disponiveisParaVenda = await requisitar('/clientes');
      assert.ok(disponiveisParaVenda.dados.every((cliente) => cliente.id !== outroClienteId));
    });

    let sessaoId;
    await teste('abre o caixa com valor inicial', async () => {
      const resposta = await requisitar('/caixa/abrir', {
        usuario_id: usuarioId,
        valor_abertura_centavos: 5000,
      });
      assert.equal(resposta.status, 201);
      assert.equal(resposta.dados.valor_abertura_centavos, 5000);
      assert.equal(resposta.dados.saldo_esperado_centavos, 5000);
      sessaoId = resposta.dados.id;
    });

    await teste('registra suprimento e sangria no saldo esperado do caixa', async () => {
      const suprimento = await requisitar('/caixa/movimentacoes', {
        tipo: 'SUPRIMENTO',
        valor_centavos: 200,
        motivo: 'Reforço de troco',
      });
      assert.equal(suprimento.status, 201);
      assert.equal(suprimento.dados.sessao.saldo_esperado_centavos, 5200);

      const sangria = await requisitar('/caixa/movimentacoes', {
        tipo: 'SANGRIA',
        valor_centavos: 100,
        motivo: 'Retirada para cofre',
      });
      assert.equal(sangria.status, 201);
      assert.equal(sangria.dados.sessao.saldo_esperado_centavos, 5100);

      const sangriaMaiorQueSaldo = await requisitar('/caixa/movimentacoes', {
        tipo: 'SANGRIA',
        valor_centavos: 5101,
        motivo: 'Teste de limite',
      });
      assert.equal(sangriaMaiorQueSaldo.status, 409);

      const motivoAusente = await requisitar('/caixa/movimentacoes', {
        tipo: 'SUPRIMENTO',
        valor_centavos: 100,
      });
      assert.equal(motivoAusente.status, 400);
    });

    await teste('impede abrir um segundo caixa', async () => {
      const resposta = await requisitar('/caixa/abrir', { usuario_id: usuarioId });
      assert.equal(resposta.status, 409);
    });

    await teste('registra venda, pagamentos mistos e baixa o estoque', async () => {
      const resposta = await requisitar('/vendas', {
        sessao_id: sessaoId,
        desconto_centavos: 100,
        itens: [
          { produto_id: produtoId, quantidade_milesimos: 1000 },
          { produto_id: produtoId, quantidade_milesimos: 1000 },
        ],
        pagamentos: [
          { forma: 'DINHEIRO', valor_centavos: 1000, troco_centavos: 500 },
          { forma: 'PIX', valor_centavos: 900 },
        ],
      });
      assert.equal(resposta.status, 201);
      assert.equal(resposta.dados.subtotal_centavos, 2000);
      assert.equal(resposta.dados.total_centavos, 1900);
      assert.equal(resposta.dados.itens.length, 2);
      assert.equal(
        db.prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?').get(produtoId)
          .quantidade_milesimos,
        8000
      );
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM vendas').get().total, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM movimentacoes_estoque WHERE tipo = ?').get('SAIDA_VENDA').total, 2);
    });

    await teste('não registra venda quando o estoque é insuficiente', async () => {
      const vendasAntes = db.prepare('SELECT COUNT(*) AS total FROM vendas').get().total;
      const resposta = await requisitar('/vendas', {
        sessao_id: sessaoId,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 9000 }],
        pagamentos: [{ forma: 'DINHEIRO', valor_centavos: 9000 }],
      });
      assert.equal(resposta.status, 409);
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM vendas').get().total, vendasAntes);
      assert.equal(
        db.prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?').get(produtoId)
          .quantidade_milesimos,
        8000
      );
    });

    await teste('exige que pagamentos fechem exatamente o total', async () => {
      const resposta = await requisitar('/vendas', {
        sessao_id: sessaoId,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 1000 }],
        pagamentos: [{ forma: 'PIX', valor_centavos: 999 }],
      });
      assert.equal(resposta.status, 400);
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM vendas').get().total, 1);
    });

    await teste('registra débito no fiado junto com a venda', async () => {
      const resposta = await requisitar('/vendas', {
        sessao_id: sessaoId,
        cliente_id: clienteId,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 1000 }],
        pagamentos: [{ forma: 'FIADO', valor_centavos: 1000 }],
      });
      assert.equal(resposta.status, 201);
      assert.equal(
        db.prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?').get(clienteId).saldo_centavos,
        1000
      );
    });

    await teste('permite fiado acima de qualquer limite fixo e atualiza o saldo', async () => {
      const resposta = await requisitar('/vendas', {
        sessao_id: sessaoId,
        cliente_id: clienteId,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 5000 }],
        pagamentos: [{ forma: 'FIADO', valor_centavos: 5000 }],
      });
      assert.equal(resposta.status, 201);
      assert.equal(
        db.prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?').get(clienteId).saldo_centavos,
        6000
      );
    });

    await teste('registra recebimento parcial do fiado e atualiza o saldo do cliente', async () => {
      const acimaDaDivida = await requisitar('/relatorios/fiado/pagamentos', {
        cliente_id: clienteId,
        valor_centavos: 6001,
        forma_pagamento: 'DINHEIRO',
      });
      assert.equal(acimaDaDivida.status, 400);
      assert.equal(
        db.prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?').get(clienteId).saldo_centavos,
        6000
      );

      const resposta = await requisitar('/relatorios/fiado/pagamentos', {
        cliente_id: clienteId,
        valor_centavos: 1000,
        forma_pagamento: 'DINHEIRO',
        observacao: 'Recebimento parcial',
      });
      assert.equal(resposta.status, 201);
      assert.equal(resposta.dados.saldo_devedor_centavos, 5000);
      const lancamento = db.prepare(
        `SELECT tipo, origem, valor_centavos, forma_pagamento, sessao_id, usuario_id, observacao
           FROM lancamentos_fiado WHERE id = ?`
      ).get(resposta.dados.id);
      assert.deepEqual(lancamento, {
        tipo: 'CREDITO',
        origem: 'PAGAMENTO',
        valor_centavos: 1000,
        forma_pagamento: 'DINHEIRO',
        sessao_id: sessaoId,
        usuario_id: usuarioId,
        observacao: 'Recebimento parcial',
      });

      const caixa = await requisitar('/caixa/aberto');
      assert.equal(caixa.dados.sessao.recebimentos_fiado_dinheiro_centavos, 1000);
      assert.equal(caixa.dados.sessao.saldo_esperado_centavos, 7100);
    });

    await teste('consulta dívidas atuais e vendas fiadas em Relatórios', async () => {
      db.prepare(
        `INSERT INTO lancamentos_fiado (id, cliente_id, tipo, origem, valor_centavos)
         VALUES (?, ?, 'CREDITO', 'PAGAMENTO', 2000),
                (?, ?, 'DEBITO', 'AJUSTE', 300)`
      ).run(randomUUID(), clienteId, randomUUID(), outroClienteId);

      const resposta = await requisitar('/relatorios/fiado');
      assert.equal(resposta.status, 200);
      assert.deepEqual(resposta.dados.resumo, {
        total_a_receber_centavos: 3300,
        clientes_devedores: 2,
        quantidade_vendas_fiadas: 2,
        total_vendas_fiadas_centavos: 6000,
      });
      assert.equal(resposta.dados.clientes.length, 2);
      assert.equal(resposta.dados.clientes[0].saldo_devedor_centavos, 3000);
      assert.equal(resposta.dados.clientes[1].saldo_devedor_centavos, 300);
      assert.equal(resposta.dados.vendas.length, 2);
      assert.equal(
        resposta.dados.vendas.reduce((total, venda) => total + venda.valor_fiado_centavos, 0),
        6000
      );
    });

    await teste('consulta extrato do fiado com saldo progressivo e paginação', async () => {
      const cliente = await requisitar('/clientes', { nome: 'Cliente Extrato' });
      assert.equal(cliente.status, 201);
      const venda = await requisitar('/vendas', {
        sessao_id: sessaoId,
        cliente_id: cliente.dados.id,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 1000 }],
        pagamentos: [{ forma: 'FIADO', valor_centavos: 1000 }],
      });
      assert.equal(venda.status, 201);
      const pagamento = await requisitar('/relatorios/fiado/pagamentos', {
        cliente_id: cliente.dados.id,
        valor_centavos: 400,
        forma_pagamento: 'PIX',
      });
      assert.equal(pagamento.status, 201);

      const paginaRecente = await requisitar(`/clientes/${cliente.dados.id}/extrato?limite=1`);
      assert.equal(paginaRecente.status, 200);
      assert.equal(paginaRecente.dados.cliente.saldo_devedor_centavos, 600);
      assert.equal(paginaRecente.dados.lancamentos.length, 1);
      assert.equal(paginaRecente.dados.lancamentos[0].origem, 'PAGAMENTO');
      assert.equal(paginaRecente.dados.lancamentos[0].saldo_apos_centavos, 600);
      assert.equal(paginaRecente.dados.proximo_deslocamento, 1);

      const paginaAnterior = await requisitar(
        `/clientes/${cliente.dados.id}/extrato?limite=1&deslocamento=${paginaRecente.dados.proximo_deslocamento}`
      );
      assert.equal(paginaAnterior.dados.lancamentos[0].origem, 'VENDA');
      assert.equal(paginaAnterior.dados.lancamentos[0].itens_venda, 'Arroz tipo 1');
      assert.equal(paginaAnterior.dados.lancamentos[0].saldo_apos_centavos, 1000);

      const inexistente = await requisitar(`/clientes/${randomUUID()}/extrato`);
      assert.equal(inexistente.status, 404);
    });

    await teste('quita totalmente uma dívida com recebimento', async () => {
      const resposta = await requisitar('/relatorios/fiado/pagamentos', {
        cliente_id: clienteId,
        valor_centavos: 3000,
        forma_pagamento: 'PIX',
      });
      assert.equal(resposta.status, 201);
      assert.equal(resposta.dados.saldo_devedor_centavos, 0);
      assert.equal(
        db.prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?').get(clienteId).saldo_centavos,
        0
      );
    });

    await teste('devolução de fiado já pago é reembolsada e não cria saldo negativo', async () => {
      db.prepare(
        `INSERT INTO movimentacoes_estoque (id, produto_id, tipo, quantidade_milesimos)
         VALUES (?, ?, 'ENTRADA', 5000)`
      ).run(randomUUID(), produtoId);
      const cliente = await requisitar('/clientes', { nome: 'Cliente com fiado quitado' });
      assert.equal(cliente.status, 201);
      const venda = await requisitar('/vendas', {
        sessao_id: sessaoId,
        cliente_id: cliente.dados.id,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 2000 }],
        pagamentos: [{ forma: 'FIADO', valor_centavos: 2000 }],
      });
      assert.equal(venda.status, 201);
      const recebimento = await requisitar('/relatorios/fiado/pagamentos', {
        cliente_id: cliente.dados.id,
        valor_centavos: 2000,
        forma_pagamento: 'DINHEIRO',
      });
      assert.equal(recebimento.status, 201);
      const caixaAntesDaDevolucao = (await requisitar('/caixa/aberto')).dados.sessao.saldo_esperado_centavos;
      const historico = await requisitar('/vendas/historico?de=2020-01-01&ate=2035-12-31');
      const vendaRegistrada = historico.dados.vendas.find((item) => item.id === venda.dados.id);
      const devolucao = await requisitar(`/vendas/${venda.dados.id}/devolver-item`, {
        venda_item_id: vendaRegistrada.itens[0].id,
        quantidade_milesimos: 1000,
        destino: 'ESTOQUE',
        motivo: 'Produto devolvido',
      });
      assert.equal(devolucao.status, 201);
      assert.equal(devolucao.dados.fiado_abatido_centavos, 0);
      assert.equal(
        db.prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?').get(cliente.dados.id).saldo_centavos,
        0
      );
      assert.equal(
        (await requisitar('/caixa/aberto')).dados.sessao.saldo_esperado_centavos,
        caixaAntesDaDevolucao - 1000
      );

      const cancelar = await requisitar(`/vendas/${venda.dados.id}/cancelar`, {
        motivo: 'Cancelamento do restante',
      });
      assert.equal(cancelar.status, 201);
      assert.equal(cancelar.dados.devolvido_em_dinheiro_centavos, 1000);
      assert.equal(
        db.prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?').get(cliente.dados.id).saldo_centavos,
        0
      );
      const final = await requisitar('/vendas/historico?de=2020-01-01&ate=2035-12-31');
      const vendaFinal = final.dados.vendas.find((item) => item.id === venda.dados.id);
      assert.equal(vendaFinal.pagamentos[0].valor_devolvido_centavos, 2000);
      assert.equal(vendaFinal.pagamentos[0].forma, 'FIADO');
      assert.equal(
        vendaFinal.devolucoes.find((devolucao) => devolucao.destino === 'SEM_ITEM').valor_centavos,
        1000
      );
      assert.equal(
        (await requisitar('/caixa/aberto')).dados.sessao.saldo_esperado_centavos,
        caixaAntesDaDevolucao - 2000
      );
    });

    await teste('devolve item parcialmente, registra descarte e evita estorno duplicado', async () => {
      db.prepare(
        `INSERT INTO movimentacoes_estoque (id, produto_id, tipo, quantidade_milesimos)
         VALUES (?, ?, 'ENTRADA', 10000)`
      ).run(randomUUID(), produtoId);
      const estoqueInicial = db.prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?')
        .get(produtoId).quantidade_milesimos;
      const venda = await requisitar('/vendas', {
        sessao_id: sessaoId,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 3000 }],
        pagamentos: [
          { forma: 'DINHEIRO', valor_centavos: 900 },
          { forma: 'PIX', valor_centavos: 2100 },
        ],
      });
      assert.equal(venda.status, 201, JSON.stringify(venda.dados));
      const caixaAposVenda = (await requisitar('/caixa/aberto')).dados.sessao.saldo_esperado_centavos;

      const historicoInicial = await requisitar('/vendas/historico?de=2020-01-01&ate=2035-12-31');
      const vendaRegistrada = historicoInicial.dados.vendas.find((item) => item.id === venda.dados.id);
      const itemId = vendaRegistrada.itens[0].id;
      const devolver = (quantidade, destino) => requisitar(`/vendas/${venda.dados.id}/devolver-item`, {
        venda_item_id: itemId,
        quantidade_milesimos: quantidade,
        destino,
        motivo: destino === 'DESCARTE' ? 'Produto vencido' : 'Devolução do cliente',
      });

      const devolucaoEstoque = await devolver(1000, 'ESTOQUE');
      assert.equal(devolucaoEstoque.status, 201);
      assert.equal(devolucaoEstoque.dados.valor_devolvido_centavos, 1000);
      assert.equal(devolucaoEstoque.dados.destino, 'ESTOQUE');
      assert.equal(
        db.prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?').get(produtoId).quantidade_milesimos,
        estoqueInicial - 2000,
        `estoque inicial ${estoqueInicial}; movimentos ${JSON.stringify(db.prepare('SELECT tipo, quantidade_milesimos FROM movimentacoes_estoque WHERE venda_id = ?').all(venda.dados.id))}`
      );

      const quantidadeExcedida = await devolver(3000, 'ESTOQUE');
      assert.equal(quantidadeExcedida.status, 409);

      const descarte = await devolver(1000, 'DESCARTE');
      assert.equal(descarte.status, 201);
      assert.equal(descarte.dados.valor_devolvido_centavos, 1000);
      assert.equal(
        db.prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?').get(produtoId).quantidade_milesimos,
        estoqueInicial - 2000
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS total FROM movimentacoes_estoque WHERE venda_id = ? AND tipo = 'AJUSTE'")
          .get(venda.dados.id).total,
        1
      );

      const historicoParcial = await requisitar('/vendas/historico?de=2020-01-01&ate=2035-12-31');
      const vendaParcial = historicoParcial.dados.vendas.find((item) => item.id === venda.dados.id);
      assert.equal(vendaParcial.itens[0].quantidade_devolvida_milesimos, 2000);
      assert.equal(vendaParcial.itens[0].quantidade_disponivel_milesimos, 1000);
      assert.equal(vendaParcial.pagamentos[0].valor_devolvido_centavos, 600);
      assert.equal(vendaParcial.pagamentos[1].valor_devolvido_centavos, 1400);
      assert.equal(vendaParcial.devolucoes.length, 2);

      const cancelar = await requisitar(`/vendas/${venda.dados.id}/cancelar`, {
        motivo: 'Cancelamento do restante da venda',
      });
      assert.equal(cancelar.status, 201);
      assert.equal(cancelar.dados.devolvido_em_dinheiro_centavos, 0);
      assert.equal(
        db.prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?').get(produtoId).quantidade_milesimos,
        estoqueInicial - 1000
      );
      const caixaFinal = (await requisitar('/caixa/aberto')).dados.sessao.saldo_esperado_centavos;
      assert.equal(caixaAposVenda - caixaFinal, 900);

      const historicoFinal = await requisitar('/vendas/historico?de=2020-01-01&ate=2035-12-31');
      const vendaFinal = historicoFinal.dados.vendas.find((item) => item.id === venda.dados.id);
      assert.ok(vendaFinal.pagamentos.every((pagamento) => pagamento.estornado));
      assert.deepEqual(
        db.prepare('SELECT forma, valor_centavos FROM estornos_venda WHERE venda_id = ? ORDER BY forma')
          .all(venda.dados.id),
        [
          { forma: 'DINHEIRO', valor_centavos: 300 },
          { forma: 'PIX', valor_centavos: 700 },
        ]
      );
    });

    await teste('consulta histórico de vendas e cancela uma venda com devoluções e estoque', async () => {
      const estoqueAntes = db.prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?')
        .get(produtoId).quantidade_milesimos;
      const estornosDinheiroAntes = (await requisitar('/caixa/aberto')).dados.sessao.estornos_dinheiro_centavos;
      const venda = await requisitar('/vendas', {
        sessao_id: sessaoId,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 1000 }],
        pagamentos: [
          { forma: 'DINHEIRO', valor_centavos: 400 },
          { forma: 'PIX', valor_centavos: 600 },
        ],
      });
      assert.equal(venda.status, 201);

      const historico = await requisitar('/vendas/historico?de=2020-01-01&ate=2035-12-31');
      assert.equal(historico.status, 200);
      const registro = historico.dados.vendas.find((item) => item.id === venda.dados.id);
      assert.equal(registro.status, 'CONCLUIDA');
      assert.equal(registro.itens[0].unidade, 'UN');
      assert.equal(registro.pagamentos.length, 2);
      assert.ok(registro.pagamentos.every((pagamento) => !pagamento.estornado));

      const semMotivo = await requisitar(`/vendas/${venda.dados.id}/cancelar`, { motivo: '   ' });
      assert.equal(semMotivo.status, 400);

      const cancelar = await requisitar(`/vendas/${venda.dados.id}/cancelar`, {
        motivo: 'Produto lançado por engano',
      });
      assert.equal(cancelar.status, 201);
      assert.equal(cancelar.dados.pagamentos_estornados, 2);
      assert.equal(
        db.prepare('SELECT status FROM vendas WHERE id = ?').get(venda.dados.id).status,
        'CANCELADA'
      );
      assert.deepEqual(
        db.prepare('SELECT forma, valor_centavos FROM estornos_venda WHERE venda_id = ? ORDER BY forma')
          .all(venda.dados.id),
        [
          { forma: 'DINHEIRO', valor_centavos: 400 },
          { forma: 'PIX', valor_centavos: 600 },
        ]
      );
      assert.equal(
        db.prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?').get(produtoId)
          .quantidade_milesimos,
        estoqueAntes
      );
      const caixa = await requisitar('/caixa/aberto');
      assert.equal(caixa.dados.sessao.estornos_dinheiro_centavos, estornosDinheiroAntes + 400);
      assert.equal(caixa.dados.sessao.saldo_esperado_centavos, 7100);

      const historicoAtualizado = await requisitar('/vendas/historico?de=2020-01-01&ate=2035-12-31');
      const vendaCancelada = historicoAtualizado.dados.vendas.find((item) => item.id === venda.dados.id);
      assert.equal(vendaCancelada.status, 'CANCELADA');
      assert.ok(vendaCancelada.pagamentos.every((pagamento) => pagamento.estornado));
      assert.equal(vendaCancelada.motivo_cancelamento, 'Produto lançado por engano');

      const repetirCancelamento = await requisitar(`/vendas/${venda.dados.id}/cancelar`, {
        motivo: 'Tentativa repetida',
      });
      assert.equal(repetirCancelamento.status, 409);

      const vendaRollback = await requisitar('/vendas', {
        sessao_id: sessaoId,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 1000 }],
        pagamentos: [{ forma: 'DINHEIRO', valor_centavos: 1000 }],
      });
      const estoqueAntesDoCancelamento = db
        .prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?')
        .get(produtoId).quantidade_milesimos;
      db.exec(`
        CREATE TRIGGER teste_falha_estorno_estoque
        BEFORE INSERT ON movimentacoes_estoque
        WHEN NEW.tipo = 'ESTORNO_VENDA'
        BEGIN
          SELECT RAISE(ABORT, 'falha simulada no estorno');
        END
      `);
      try {
        const falha = await requisitar(`/vendas/${vendaRollback.dados.id}/cancelar`, {
          motivo: 'Teste de reversão transacional',
        });
        assert.equal(falha.status, 400);
      } finally {
        db.exec('DROP TRIGGER teste_falha_estorno_estoque');
      }
      assert.equal(
        db.prepare('SELECT status FROM vendas WHERE id = ?').get(vendaRollback.dados.id).status,
        'CONCLUIDA'
      );
      assert.equal(
        db.prepare('SELECT COUNT(*) AS total FROM estornos_venda WHERE venda_id = ?')
          .get(vendaRollback.dados.id).total,
        0
      );
      assert.equal(
        db.prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?')
          .get(produtoId).quantidade_milesimos,
        estoqueAntesDoCancelamento
      );
      const cancelamentoFinal = await requisitar(`/vendas/${vendaRollback.dados.id}/cancelar`, {
        motivo: 'Cancelamento após teste',
      });
      assert.equal(cancelamentoFinal.status, 201);
    });

    await teste('estorna o fiado e o estoque ao cancelar venda fiada', async () => {
      const cliente = await requisitar('/clientes', { nome: 'Cliente de Cancelamento' });
      assert.equal(cliente.status, 201);
      const venda = await requisitar('/vendas', {
        sessao_id: sessaoId,
        cliente_id: cliente.dados.id,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 1000 }],
        pagamentos: [{ forma: 'FIADO', valor_centavos: 1000 }],
      });
      assert.equal(venda.status, 201);
      assert.equal(
        db.prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?')
          .get(cliente.dados.id).saldo_centavos,
        1000
      );

      const cancelar = await requisitar(`/vendas/${venda.dados.id}/cancelar`, {
        motivo: 'Cliente desistiu da compra',
      });
      assert.equal(cancelar.status, 201);
      assert.equal(cancelar.dados.fiado_estornado_centavos, 1000);
      assert.equal(
        db.prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?')
          .get(cliente.dados.id).saldo_centavos,
        0
      );
    });

    await teste('consulta faturamento e valida as datas do relatório', async () => {
      const resposta = await requisitar('/relatorios/faturamento?de=2025-01-01&ate=2025-01-02');
      assert.equal(resposta.status, 200);
      assert.equal(resposta.dados.periodo.de, '2025-01-01');
      assert.equal(resposta.dados.periodo.ate, '2025-01-02');
      assert.equal(resposta.dados.serie.length, 2);

      const dataInvalida = await requisitar('/relatorios/faturamento?de=2025-02-30&ate=2025-03-01');
      assert.equal(dataInvalida.status, 400);
    });

    await teste('desfaz a venda inteira se um lançamento falhar', async () => {
      const vendasAntes = db.prepare('SELECT COUNT(*) AS total FROM vendas').get().total;
      const estoqueAntes = db
        .prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?')
        .get(produtoId).quantidade_milesimos;
      db.exec(`
        CREATE TRIGGER teste_falha_pagamento
        BEFORE INSERT ON pagamentos
        BEGIN
          SELECT RAISE(ABORT, 'falha simulada');
        END
      `);
      try {
        const resposta = await requisitar('/vendas', {
          sessao_id: sessaoId,
          itens: [{ produto_id: produtoId, quantidade_milesimos: 1000 }],
          pagamentos: [{ forma: 'PIX', valor_centavos: 1000 }],
        });
        assert.equal(resposta.status, 400);
      } finally {
        db.exec('DROP TRIGGER teste_falha_pagamento');
      }
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM vendas').get().total, vendasAntes);
      assert.equal(
        db.prepare('SELECT quantidade_milesimos FROM estoque_atual WHERE produto_id = ?').get(produtoId)
          .quantidade_milesimos,
        estoqueAntes
      );
    });

    await teste('fecha o caixa com conferência de dinheiro e diferença', async () => {
      db.prepare(
        `INSERT INTO movimentacoes_caixa (id, sessao_id, tipo, valor_centavos)
         VALUES (?, ?, 'SUPRIMENTO', 400), (?, ?, 'SANGRIA', 100)`
      ).run(randomUUID(), sessaoId, randomUUID(), sessaoId);
      const resposta = await requisitar('/caixa/fechar', { valor_contado_centavos: 6200 });
      assert.equal(resposta.status, 200);
      assert.equal(resposta.dados.valor_esperado_centavos, 7400);
      assert.equal(resposta.dados.diferenca_centavos, -1200);
    });

    await teste('não permite registrar recebimento com caixa fechado', async () => {
      const resposta = await requisitar('/relatorios/fiado/pagamentos', {
        cliente_id: clienteId,
        valor_centavos: 100,
        forma_pagamento: 'PIX',
      });
      assert.equal(resposta.status, 409);
    });

    await teste('não permite movimentar caixa fechado', async () => {
      const resposta = await requisitar('/caixa/movimentacoes', {
        tipo: 'SANGRIA',
        valor_centavos: 100,
        motivo: 'Teste após fechar',
      });
      assert.equal(resposta.status, 409);
    });

    await teste('não permite vender com caixa fechado', async () => {
      const resposta = await requisitar('/vendas', {
        sessao_id: sessaoId,
        itens: [{ produto_id: produtoId, quantidade_milesimos: 1000 }],
        pagamentos: [{ forma: 'PIX', valor_centavos: 1000 }],
      });
      assert.equal(resposta.status, 409);
    });

    console.log(`\n${total} verificações da API passaram.`);
  } finally {
    await new Promise((resolve, reject) => {
      servidor.close((erro) => (erro ? reject(erro) : resolve()));
    });
    db.close();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
