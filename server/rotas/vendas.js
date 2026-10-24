const express = require('express');
const { randomUUID } = require('node:crypto');
const { ErroDeRequisicao } = require('../erros');
const { dataUtc } = require('../relatorio-faturamento');

const FORMAS_PAGAMENTO = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'FIADO'];
const MAX_ITENS = 100;

function inteiroNaoNegativo(valor, campo) {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new ErroDeRequisicao(400, `${campo} deve ser um número inteiro maior ou igual a zero.`);
  }
  return valor;
}

function somarSeguro(a, b, campo) {
  const soma = a + b;
  if (!Number.isSafeInteger(soma)) {
    throw new ErroDeRequisicao(400, `${campo} excede o valor máximo permitido.`);
  }
  return soma;
}

function calcularTotalItem(precoCentavos, quantidadeMilesimos) {
  const total = (BigInt(precoCentavos) * BigInt(quantidadeMilesimos) + 500n) / 1000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ErroDeRequisicao(400, 'O total de um item excede o valor máximo permitido.');
  }
  return Number(total);
}

module.exports = function rotasVendas(db) {
  const router = express.Router();

  router.get('/historico', (req, res) => {
    const hoje = new Date();
    const hojeLocal = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 29);
    const inicioLocal = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-${String(inicio.getDate()).padStart(2, '0')}`;
    const de = dataUtc(req.query.de ?? inicioLocal, 'de');
    const ate = dataUtc(req.query.ate ?? hojeLocal, 'ate');
    if (de > ate) throw new ErroDeRequisicao(400, 'A data inicial não pode ser depois da data final.');

    const limiteSolicitado = Number.parseInt(req.query.limite, 10);
    const limite = Number.isInteger(limiteSolicitado)
      ? Math.min(Math.max(limiteSolicitado, 1), 200)
      : 100;
    const vendas = db.prepare(
      `SELECT v.id, v.criado_em, v.status, v.subtotal_centavos, v.desconto_centavos,
              v.total_centavos, v.cliente_id, c.nome AS cliente_nome,
              v.motivo_cancelamento, v.cancelada_em,
              u.nome AS operador_nome, uc.nome AS cancelada_por_nome
         FROM vendas v
         JOIN usuarios u ON u.id = v.usuario_id
         LEFT JOIN clientes c ON c.id = v.cliente_id
         LEFT JOIN usuarios uc ON uc.id = v.cancelada_por_usuario_id
        WHERE date(v.criado_em, 'localtime') BETWEEN ? AND ?
        ORDER BY v.criado_em DESC, v.rowid DESC
        LIMIT ?`
    ).all(de.toISOString().slice(0, 10), ate.toISOString().slice(0, 10), limite);

    if (vendas.length) {
      const placeholders = vendas.map(() => '?').join(', ');
      const ids = vendas.map((venda) => venda.id);
      const itens = db.prepare(
        `SELECT i.id, i.venda_id, i.produto_id, i.descricao, i.quantidade_milesimos, i.preco_unitario_centavos,
                 i.desconto_centavos, i.total_centavos, p.unidade,
                 COALESCE((SELECT SUM(di.quantidade_milesimos)
                             FROM devolucoes_venda_itens di
                            WHERE di.venda_item_id = i.id), 0) AS quantidade_devolvida_milesimos,
                 COALESCE((SELECT SUM(di.valor_centavos)
                             FROM devolucoes_venda_itens di
                            WHERE di.venda_item_id = i.id), 0) AS valor_devolvido_centavos
            FROM venda_itens i
            JOIN produtos p ON p.id = i.produto_id
           WHERE i.venda_id IN (${placeholders})
            ORDER BY i.rowid`
      ).all(...ids);
      const pagamentos = db.prepare(
        `SELECT p.venda_id, p.id, p.forma, p.valor_centavos, p.troco_centavos,
                 e.id AS estorno_id,
                 e.valor_centavos AS estorno_total_centavos,
                 COALESCE((SELECT SUM(dp.valor_centavos)
                             FROM devolucoes_venda_pagamentos dp
                            WHERE dp.pagamento_id = p.id), 0) AS devolvido_parcial_centavos
            FROM pagamentos p
           LEFT JOIN estornos_venda e ON e.pagamento_id = p.id
           WHERE p.venda_id IN (${placeholders})
           ORDER BY p.rowid`
      ).all(...ids);
      const devolucoes = db.prepare(
        `SELECT d.id, d.venda_id, d.destino, d.motivo, d.criado_em,
                 i.descricao, p.unidade, di.quantidade_milesimos,
                 COALESCE(di.valor_centavos,
                   (SELECT SUM(dp.valor_centavos)
                      FROM devolucoes_venda_pagamentos dp
                     WHERE dp.devolucao_id = d.id), 0) AS valor_centavos
            FROM devolucoes_venda d
            LEFT JOIN devolucoes_venda_itens di ON di.devolucao_id = d.id
            LEFT JOIN venda_itens i ON i.id = di.venda_item_id
            LEFT JOIN produtos p ON p.id = i.produto_id
           WHERE d.venda_id IN (${placeholders})
           ORDER BY d.criado_em DESC, d.rowid DESC`
      ).all(...ids);
      const itensPorVenda = new Map(vendas.map((venda) => [venda.id, []]));
      const pagamentosPorVenda = new Map(vendas.map((venda) => [venda.id, []]));
      const devolucoesPorVenda = new Map(vendas.map((venda) => [venda.id, []]));
      for (const item of itens) itensPorVenda.get(item.venda_id).push(item);
      for (const pagamento of pagamentos) {
        const { venda_id, estorno_id, estorno_total_centavos, devolvido_parcial_centavos, ...dados } = pagamento;
        const valorDevolvido = (estorno_total_centavos ?? 0) + devolvido_parcial_centavos;
        pagamentosPorVenda.get(venda_id).push({
           ...dados,
           valor_devolvido_centavos: valorDevolvido,
           estornado: valorDevolvido >= dados.valor_centavos,
        });
      }
      for (const devolucao of devolucoes) {
        devolucoesPorVenda.get(devolucao.venda_id).push(devolucao);
      }
      for (const venda of vendas) {
        venda.itens = itensPorVenda.get(venda.id).map((item) => ({
          ...item,
          quantidade_disponivel_milesimos: item.quantidade_milesimos - item.quantidade_devolvida_milesimos,
        }));
        venda.pagamentos = pagamentosPorVenda.get(venda.id);
        venda.devolucoes = devolucoesPorVenda.get(venda.id);
      }
    }

    res.json({
      periodo: { de: de.toISOString().slice(0, 10), ate: ate.toISOString().slice(0, 10) },
      vendas,
      limite,
    });
  });

  router.post('/', (req, res) => {
    const corpo = req.body ?? {};
    if (typeof corpo.sessao_id !== 'string' || !corpo.sessao_id.trim()) {
      throw new ErroDeRequisicao(400, 'Informe o sessao_id do caixa aberto.');
    }
    if (!Array.isArray(corpo.itens) || corpo.itens.length === 0 || corpo.itens.length > MAX_ITENS) {
      throw new ErroDeRequisicao(400, `Informe de 1 a ${MAX_ITENS} itens na venda.`);
    }
    if (!Array.isArray(corpo.pagamentos) || corpo.pagamentos.length === 0) {
      throw new ErroDeRequisicao(400, 'Informe ao menos uma forma de pagamento.');
    }

    const descontoVenda = inteiroNaoNegativo(corpo.desconto_centavos ?? 0, 'desconto_centavos');
    const clienteId = corpo.cliente_id ?? null;
    if (clienteId !== null && (typeof clienteId !== 'string' || !clienteId.trim())) {
      throw new ErroDeRequisicao(400, 'cliente_id deve ser um identificador válido.');
    }

    const venda = db.transaction(() => {
      const sessao = db
        .prepare(
          `SELECT s.id, s.usuario_id
             FROM caixa_sessoes s
             JOIN usuarios u ON u.id = s.usuario_id AND u.ativo = 1
            WHERE s.id = ? AND s.fechado_em IS NULL`
        )
        .get(corpo.sessao_id);
      if (!sessao) throw new ErroDeRequisicao(409, 'Caixa fechado ou não encontrado.');

      const itens = [];
      const quantidadesPorProduto = new Map();
      let subtotal = 0;

      for (const [indice, item] of corpo.itens.entries()) {
        if (!item || typeof item.produto_id !== 'string' || !item.produto_id.trim()) {
          throw new ErroDeRequisicao(400, `Informe o produto_id do item ${indice + 1}.`);
        }
        const quantidade = inteiroNaoNegativo(item.quantidade_milesimos, `itens[${indice}].quantidade_milesimos`);
        if (quantidade === 0) {
          throw new ErroDeRequisicao(400, `A quantidade do item ${indice + 1} deve ser maior que zero.`);
        }
        const desconto = inteiroNaoNegativo(item.desconto_centavos ?? 0, `itens[${indice}].desconto_centavos`);
        const produto = db
          .prepare(
            `SELECT p.id, p.nome, p.preco_venda_centavos, p.preco_custo_centavos,
                    e.quantidade_milesimos AS estoque_milesimos
               FROM produtos p
               JOIN estoque_atual e ON e.produto_id = p.id
              WHERE p.id = ? AND p.ativo = 1`
          )
          .get(item.produto_id);
        if (!produto) throw new ErroDeRequisicao(404, `Produto do item ${indice + 1} não encontrado ou inativo.`);

        const bruto = calcularTotalItem(produto.preco_venda_centavos, quantidade);
        if (desconto > bruto) {
          throw new ErroDeRequisicao(400, `O desconto do item ${indice + 1} não pode superar seu valor.`);
        }
        const total = bruto - desconto;
        subtotal = somarSeguro(subtotal, total, 'subtotal_centavos');
        itens.push({
          produto,
          quantidade_milesimos: quantidade,
          desconto_centavos: desconto,
          total_centavos: total,
        });
        quantidadesPorProduto.set(
          produto.id,
          somarSeguro(quantidadesPorProduto.get(produto.id) ?? 0, quantidade, 'quantidade_milesimos')
        );
      }

      if (descontoVenda > subtotal) {
        throw new ErroDeRequisicao(400, 'O desconto da venda não pode superar o subtotal.');
      }
      const totalVenda = subtotal - descontoVenda;
      if (totalVenda <= 0) {
        throw new ErroDeRequisicao(400, 'O total da venda deve ser maior que zero.');
      }

      for (const [produtoId, quantidade] of quantidadesPorProduto) {
        const produto = itens.find((item) => item.produto.id === produtoId).produto;
        if (produto.estoque_milesimos < quantidade) {
          throw new ErroDeRequisicao(409, `Estoque insuficiente para "${produto.nome}".`);
        }
      }

      const pagamentos = [];
      let totalPago = 0;
      let totalFiado = 0;
      for (const [indice, pagamento] of corpo.pagamentos.entries()) {
        if (!pagamento || !FORMAS_PAGAMENTO.includes(pagamento.forma)) {
          throw new ErroDeRequisicao(
            400,
            `A forma de pagamento do item ${indice + 1} deve ser uma de: ${FORMAS_PAGAMENTO.join(', ')}.`
          );
        }
        const valor = inteiroNaoNegativo(pagamento.valor_centavos, `pagamentos[${indice}].valor_centavos`);
        if (valor === 0) {
          throw new ErroDeRequisicao(400, `O pagamento ${indice + 1} deve ser maior que zero.`);
        }
        const troco = inteiroNaoNegativo(pagamento.troco_centavos ?? 0, `pagamentos[${indice}].troco_centavos`);
        if (troco > 0 && pagamento.forma !== 'DINHEIRO') {
          throw new ErroDeRequisicao(400, 'Troco só pode ser informado para pagamento em dinheiro.');
        }
        totalPago = somarSeguro(totalPago, valor, 'total dos pagamentos');
        if (pagamento.forma === 'FIADO') totalFiado = somarSeguro(totalFiado, valor, 'total fiado');
        pagamentos.push({ forma: pagamento.forma, valor_centavos: valor, troco_centavos: troco });
      }
      if (totalPago !== totalVenda) {
        throw new ErroDeRequisicao(400, 'A soma dos pagamentos deve ser igual ao total da venda.');
      }

      if (totalFiado > 0 && !clienteId) {
        throw new ErroDeRequisicao(400, 'Selecione um cliente para pagamento no fiado.');
      }

      if (clienteId) {
        const cliente = db
          .prepare(
            'SELECT id, ativo, bloqueado FROM clientes WHERE id = ?'
          )
          .get(clienteId);
        if (!cliente) throw new ErroDeRequisicao(404, 'Cliente não encontrado.');
        if (totalFiado > 0) {
          if (!cliente.ativo || cliente.bloqueado) {
            throw new ErroDeRequisicao(409, 'Cliente inativo ou bloqueado para compras no fiado.');
          }
        }
      }

      const vendaId = randomUUID();
      db.prepare(
        `INSERT INTO vendas
           (id, sessao_id, usuario_id, cliente_id, subtotal_centavos, desconto_centavos, total_centavos)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(vendaId, sessao.id, sessao.usuario_id, clienteId, subtotal, descontoVenda, totalVenda);

      const inserirItem = db.prepare(
        `INSERT INTO venda_itens
           (id, venda_id, produto_id, descricao, quantidade_milesimos, preco_unitario_centavos,
            desconto_centavos, total_centavos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const inserirMovimentacaoEstoque = db.prepare(
        `INSERT INTO movimentacoes_estoque
           (id, produto_id, tipo, quantidade_milesimos, custo_unitario_centavos, venda_id, usuario_id)
         VALUES (?, ?, 'SAIDA_VENDA', ?, ?, ?, ?)`
      );
      for (const item of itens) {
        inserirItem.run(
          randomUUID(),
          vendaId,
          item.produto.id,
          item.produto.nome,
          item.quantidade_milesimos,
          item.produto.preco_venda_centavos,
          item.desconto_centavos,
          item.total_centavos
        );
        inserirMovimentacaoEstoque.run(
          randomUUID(),
          item.produto.id,
          -item.quantidade_milesimos,
          item.produto.preco_custo_centavos,
          vendaId,
          sessao.usuario_id
        );
      }

      const inserirPagamento = db.prepare(
        `INSERT INTO pagamentos (id, venda_id, forma, valor_centavos, troco_centavos)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const pagamento of pagamentos) {
        inserirPagamento.run(
          randomUUID(),
          vendaId,
          pagamento.forma,
          pagamento.valor_centavos,
          pagamento.troco_centavos
        );
      }

      if (totalFiado > 0) {
        db.prepare(
          `INSERT INTO lancamentos_fiado
             (id, cliente_id, tipo, origem, valor_centavos, venda_id, sessao_id, usuario_id)
           VALUES (?, ?, 'DEBITO', 'VENDA', ?, ?, ?, ?)`
        ).run(randomUUID(), clienteId, totalFiado, vendaId, sessao.id, sessao.usuario_id);
      }

      return {
        id: vendaId,
        sessao_id: sessao.id,
        cliente_id: clienteId,
        subtotal_centavos: subtotal,
        desconto_centavos: descontoVenda,
        total_centavos: totalVenda,
        itens: itens.map((item) => ({
          produto_id: item.produto.id,
          descricao: item.produto.nome,
          quantidade_milesimos: item.quantidade_milesimos,
          preco_unitario_centavos: item.produto.preco_venda_centavos,
          desconto_centavos: item.desconto_centavos,
          total_centavos: item.total_centavos,
        })),
        pagamentos,
      };
    }).immediate();

    res.status(201).json(venda);
  });

  router.post('/:id/devolver-item', (req, res) => {
    const corpo = req.body ?? {};
    const motivo = String(corpo.motivo ?? '').trim();
    if (!motivo) throw new ErroDeRequisicao(400, 'Informe o motivo da devolução.');
    if (motivo.length > 500) throw new ErroDeRequisicao(400, 'O motivo deve ter no máximo 500 caracteres.');
    if (corpo.destino !== 'ESTOQUE' && corpo.destino !== 'DESCARTE') {
      throw new ErroDeRequisicao(400, 'Escolha se o produto volta ao estoque ou será descartado.');
    }
    if (typeof corpo.venda_item_id !== 'string' || !corpo.venda_item_id.trim()) {
      throw new ErroDeRequisicao(400, 'Informe o item da venda.');
    }
    const quantidade = corpo.quantidade_milesimos;
    if (!Number.isSafeInteger(quantidade) || quantidade <= 0) {
      throw new ErroDeRequisicao(400, 'Informe uma quantidade válida para devolver.');
    }

    const resultado = db.transaction(() => {
      const sessao = db
        .prepare(
          `SELECT s.id, s.usuario_id
             FROM caixa_sessoes s
             JOIN usuarios u ON u.id = s.usuario_id AND u.ativo = 1
            WHERE s.fechado_em IS NULL`
        )
        .get();
      if (!sessao) throw new ErroDeRequisicao(409, 'Abra o caixa antes de registrar uma devolução.');

      const venda = db.prepare(
        `SELECT id, status, cliente_id, subtotal_centavos, desconto_centavos
           FROM vendas WHERE id = ?`
      ).get(req.params.id);
      if (!venda) throw new ErroDeRequisicao(404, 'Venda não encontrada.');
      if (venda.status !== 'CONCLUIDA') throw new ErroDeRequisicao(409, 'Só é possível devolver itens de uma venda concluída.');
      if (venda.desconto_centavos !== 0) {
        throw new ErroDeRequisicao(409, 'Devolução parcial de vendas com desconto ainda não está disponível.');
      }

      const item = db.prepare(
        `SELECT i.id, i.venda_id, i.produto_id, i.quantidade_milesimos,
                i.preco_unitario_centavos, i.desconto_centavos, p.unidade
           FROM venda_itens i
           JOIN produtos p ON p.id = i.produto_id
          WHERE i.id = ? AND i.venda_id = ?`
      ).get(corpo.venda_item_id, venda.id);
      if (!item) throw new ErroDeRequisicao(404, 'Item não encontrado nesta venda.');
      if (item.desconto_centavos !== 0) {
        throw new ErroDeRequisicao(409, 'Devolução parcial de itens com desconto ainda não está disponível.');
      }
      if (item.unidade === 'UN' && quantidade % 1000 !== 0) {
        throw new ErroDeRequisicao(400, 'A quantidade devolvida deve ser inteira para este produto.');
      }

      const devolvido = db.prepare(
        `SELECT COALESCE(SUM(quantidade_milesimos), 0) AS quantidade_milesimos,
                COALESCE(SUM(valor_centavos), 0) AS valor_centavos
           FROM devolucoes_venda_itens WHERE venda_item_id = ?`
      ).get(item.id);
      if (quantidade > item.quantidade_milesimos - devolvido.quantidade_milesimos) {
        throw new ErroDeRequisicao(409, 'A quantidade informada supera o que ainda pode ser devolvido.');
      }

      const quantidadeAcumulada = devolvido.quantidade_milesimos + quantidade;
      const valorAcumuladoDoItem = calcularTotalItem(item.preco_unitario_centavos, quantidadeAcumulada);
      const valorCentavos = valorAcumuladoDoItem - devolvido.valor_centavos;
      if (valorCentavos <= 0) {
        throw new ErroDeRequisicao(400, 'A quantidade é pequena demais para gerar uma devolução em centavos.');
      }

      const totalDevolvido = db.prepare(
        `SELECT COALESCE(SUM(di.valor_centavos), 0) AS valor_centavos
           FROM devolucoes_venda_itens di
           JOIN devolucoes_venda d ON d.id = di.devolucao_id
          WHERE d.venda_id = ?`
      ).get(venda.id).valor_centavos;
      const totalAcumulado = totalDevolvido + valorCentavos;
      const pagamentos = db.prepare(
        `SELECT id, forma, valor_centavos
           FROM pagamentos WHERE venda_id = ? ORDER BY rowid`
      ).all(venda.id);
      const totalPagamentos = pagamentos.reduce((total, pagamento) => total + pagamento.valor_centavos, 0);
      if (!pagamentos.length || totalPagamentos !== venda.subtotal_centavos) {
        throw new ErroDeRequisicao(409, 'Não foi possível calcular a devolução dos pagamentos desta venda.');
      }

      const jaDevolvidoPorPagamento = new Map(db.prepare(
        `SELECT dp.pagamento_id, SUM(dp.valor_centavos) AS valor_centavos
           FROM devolucoes_venda_pagamentos dp
           JOIN devolucoes_venda d ON d.id = dp.devolucao_id
          WHERE d.venda_id = ?
          GROUP BY dp.pagamento_id`
      ).all(venda.id).map((linha) => [linha.pagamento_id, linha.valor_centavos]));

      let saldoFiado = 0;
      if (pagamentos.some((pagamento) => pagamento.forma === 'FIADO')) {
        if (!venda.cliente_id) throw new ErroDeRequisicao(409, 'A venda fiada não tem cliente vinculado.');
        saldoFiado = db.prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?')
          .get(venda.cliente_id).saldo_centavos;
      }

      const devolucaoId = randomUUID();
      db.prepare(
        `INSERT INTO devolucoes_venda
           (id, venda_id, sessao_id, usuario_id, destino, motivo)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(devolucaoId, venda.id, sessao.id, sessao.usuario_id, corpo.destino, motivo);
      db.prepare(
        `INSERT INTO devolucoes_venda_itens
           (id, devolucao_id, venda_item_id, quantidade_milesimos, valor_centavos)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), devolucaoId, item.id, quantidade, valorCentavos);

      let alocado = 0;
      let creditoFiado = 0;
      const inserirPagamentoDevolvido = db.prepare(
        `INSERT INTO devolucoes_venda_pagamentos
           (id, devolucao_id, pagamento_id, forma, valor_centavos)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const [indice, pagamento] of pagamentos.entries()) {
        const alvoAcumulado = indice === pagamentos.length - 1
          ? totalAcumulado - alocado
          : Number((BigInt(totalAcumulado) * BigInt(pagamento.valor_centavos)) / BigInt(totalPagamentos));
        alocado += alvoAcumulado;
        const parcela = alvoAcumulado - (jaDevolvidoPorPagamento.get(pagamento.id) ?? 0);
        if (parcela <= 0) continue;

        if (pagamento.forma === 'FIADO') {
          const abaterFiado = Math.min(parcela, Math.max(saldoFiado, 0));
          if (abaterFiado > 0) {
            inserirPagamentoDevolvido.run(randomUUID(), devolucaoId, pagamento.id, 'FIADO', abaterFiado);
            creditoFiado += abaterFiado;
            saldoFiado -= abaterFiado;
          }
          if (parcela > abaterFiado) {
            inserirPagamentoDevolvido.run(randomUUID(), devolucaoId, pagamento.id, 'DINHEIRO', parcela - abaterFiado);
          }
        } else {
          inserirPagamentoDevolvido.run(randomUUID(), devolucaoId, pagamento.id, pagamento.forma, parcela);
        }
      }

      if (creditoFiado > 0) {
        db.prepare(
          `INSERT INTO lancamentos_fiado
             (id, cliente_id, tipo, origem, valor_centavos, venda_id, sessao_id, usuario_id, observacao)
           VALUES (?, ?, 'CREDITO', 'ESTORNO', ?, ?, ?, ?, ?)`
        ).run(randomUUID(), venda.cliente_id, creditoFiado, venda.id, sessao.id, sessao.usuario_id, `Devolução: ${motivo}`);
      }

      db.prepare(
        `INSERT INTO movimentacoes_estoque
           (id, produto_id, tipo, quantidade_milesimos, venda_id, usuario_id, observacao)
         VALUES (?, ?, 'ESTORNO_VENDA', ?, ?, ?, ?)`
      ).run(randomUUID(), item.produto_id, quantidade, venda.id, sessao.usuario_id, `Devolução: ${motivo}`);
      if (corpo.destino === 'DESCARTE') {
        db.prepare(
          `INSERT INTO movimentacoes_estoque
             (id, produto_id, tipo, quantidade_milesimos, venda_id, usuario_id, observacao)
           VALUES (?, ?, 'AJUSTE', ?, ?, ?, ?)`
        ).run(randomUUID(), item.produto_id, -quantidade, venda.id, sessao.usuario_id, `Descarte após devolução: ${motivo}`);
      }

      return {
        devolucao_id: devolucaoId,
        venda_id: venda.id,
        item_id: item.id,
        quantidade_devolvida_milesimos: quantidade,
        valor_devolvido_centavos: valorCentavos,
        fiado_abatido_centavos: creditoFiado,
        destino: corpo.destino,
      };
    }).immediate();

    res.status(201).json(resultado);
  });

  router.post('/:id/cancelar', (req, res) => {
    const motivo = String((req.body ?? {}).motivo ?? '').trim();
    if (!motivo) throw new ErroDeRequisicao(400, 'Informe o motivo do cancelamento.');
    if (motivo.length > 500) throw new ErroDeRequisicao(400, 'O motivo deve ter no máximo 500 caracteres.');

    const resultado = db.transaction(() => {
      const sessao = db
        .prepare(
          `SELECT s.id, s.usuario_id
             FROM caixa_sessoes s
             JOIN usuarios u ON u.id = s.usuario_id AND u.ativo = 1
            WHERE s.fechado_em IS NULL`
        )
        .get();
      if (!sessao) throw new ErroDeRequisicao(409, 'Abra o caixa antes de cancelar uma venda.');

      const venda = db.prepare(
        `SELECT id, status, cliente_id FROM vendas WHERE id = ?`
      ).get(req.params.id);
      if (!venda) throw new ErroDeRequisicao(404, 'Venda não encontrada.');
      if (venda.status !== 'CONCLUIDA') throw new ErroDeRequisicao(409, 'Esta venda já foi cancelada.');

      const pagamentos = db.prepare(
        `SELECT id, forma, valor_centavos FROM pagamentos WHERE venda_id = ? ORDER BY rowid`
      ).all(venda.id);
      if (!pagamentos.length) throw new ErroDeRequisicao(409, 'A venda não tem pagamentos para estornar.');
      const devolvidoPorPagamento = new Map(db.prepare(
        `SELECT dp.pagamento_id, SUM(dp.valor_centavos) AS valor_centavos
           FROM devolucoes_venda_pagamentos dp
           JOIN devolucoes_venda d ON d.id = dp.devolucao_id
          WHERE d.venda_id = ?
          GROUP BY dp.pagamento_id`
      ).all(venda.id).map((linha) => [linha.pagamento_id, linha.valor_centavos]));
      const inserirEstorno = db.prepare(
        `INSERT INTO estornos_venda
           (id, venda_id, pagamento_id, forma, valor_centavos, sessao_id, usuario_id, motivo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      let saldoFiado = venda.cliente_id
        ? db.prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?').get(venda.cliente_id).saldo_centavos
        : 0;
      let pagamentosEstornados = 0;
      let estornoFiadoCentavos = 0;
      let devolucaoDinheiroFiado = 0;
      const creditoFiadoPorPagamento = new Map();
      let devolucaoFiadoId = null;
      for (const pagamento of pagamentos) {
        const restante = pagamento.valor_centavos - (devolvidoPorPagamento.get(pagamento.id) ?? 0);
        if (restante <= 0) continue;
        pagamentosEstornados++;
        let valorEstorno = restante;
        if (pagamento.forma === 'FIADO') {
          valorEstorno = Math.min(restante, Math.max(saldoFiado, 0));
          saldoFiado -= valorEstorno;
          creditoFiadoPorPagamento.set(pagamento.id, valorEstorno);
          devolucaoDinheiroFiado += restante - valorEstorno;
        }
        if (valorEstorno > 0) {
          inserirEstorno.run(
            randomUUID(), venda.id, pagamento.id, pagamento.forma,
            valorEstorno, sessao.id, sessao.usuario_id, motivo
          );
          if (pagamento.forma === 'FIADO') estornoFiadoCentavos += valorEstorno;
        }
      }

      if (devolucaoDinheiroFiado > 0) {
        devolucaoFiadoId = randomUUID();
        db.prepare(
          `INSERT INTO devolucoes_venda
             (id, venda_id, sessao_id, usuario_id, destino, motivo)
           VALUES (?, ?, ?, ?, 'SEM_ITEM', ?)`
        ).run(devolucaoFiadoId, venda.id, sessao.id, sessao.usuario_id, `Devolução em dinheiro de fiado já pago: ${motivo}`);
        const pagamentosFiado = pagamentos.filter((pagamento) => pagamento.forma === 'FIADO');
        let restanteDinheiro = devolucaoDinheiroFiado;
        for (const pagamento of pagamentosFiado) {
          const jaDevolvido = devolvidoPorPagamento.get(pagamento.id) ?? 0;
          const restante = pagamento.valor_centavos - jaDevolvido;
          const creditado = creditoFiadoPorPagamento.get(pagamento.id) ?? 0;
          const devolucaoDinheiro = restante - creditado;
          if (devolucaoDinheiro > 0 && restanteDinheiro > 0) {
            const valor = Math.min(devolucaoDinheiro, restanteDinheiro);
            db.prepare(
              `INSERT INTO devolucoes_venda_pagamentos
                 (id, devolucao_id, pagamento_id, forma, valor_centavos)
               VALUES (?, ?, ?, 'DINHEIRO', ?)`
            ).run(randomUUID(), devolucaoFiadoId, pagamento.id, valor);
            restanteDinheiro -= valor;
          }
        }
      }

      const itensVenda = db.prepare(
        `SELECT i.id, i.produto_id, i.quantidade_milesimos,
                COALESCE((SELECT SUM(di.quantidade_milesimos)
                            FROM devolucoes_venda_itens di
                           WHERE di.venda_item_id = i.id), 0) AS quantidade_devolvida_milesimos
           FROM venda_itens i
          WHERE i.venda_id = ?`
      ).all(venda.id);
      if (!itensVenda.length) throw new ErroDeRequisicao(409, 'A venda não tem itens para estornar.');
      const inserirEstornoEstoque = db.prepare(
        `INSERT INTO movimentacoes_estoque
           (id, produto_id, tipo, quantidade_milesimos, venda_id, usuario_id, observacao)
         VALUES (?, ?, 'ESTORNO_VENDA', ?, ?, ?, ?)`
      );
      let itensEstornados = 0;
      for (const item of itensVenda) {
        const restante = item.quantidade_milesimos - item.quantidade_devolvida_milesimos;
        if (restante <= 0) continue;
        inserirEstornoEstoque.run(
          randomUUID(), item.produto_id, restante, venda.id, sessao.usuario_id, `Cancelamento da venda: ${motivo}`
        );
        itensEstornados++;
      }

      const creditoFiado = estornoFiadoCentavos;
      if (creditoFiado > 0) {
        db.prepare(
          `INSERT INTO lancamentos_fiado
             (id, cliente_id, tipo, origem, valor_centavos, venda_id, sessao_id, usuario_id, observacao)
           VALUES (?, ?, 'CREDITO', 'ESTORNO', ?, ?, ?, ?, ?)`
        ).run(randomUUID(), venda.cliente_id, creditoFiado, venda.id, sessao.id, sessao.usuario_id, motivo);
      }

      const atualizada = db.prepare(
        `UPDATE vendas
            SET status = 'CANCELADA',
                cancelada_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                motivo_cancelamento = ?,
                cancelada_por_usuario_id = ?,
                cancelada_sessao_id = ?
          WHERE id = ? AND status = 'CONCLUIDA'`
      ).run(motivo, sessao.usuario_id, sessao.id, venda.id);
      if (atualizada.changes !== 1) throw new ErroDeRequisicao(409, 'Esta venda já foi cancelada.');

      return {
        venda_id: venda.id,
        sessao_id: sessao.id,
        estoque_estornado: itensEstornados,
        pagamentos_estornados: pagamentosEstornados,
        fiado_estornado_centavos: creditoFiado,
        devolvido_em_dinheiro_centavos: devolucaoDinheiroFiado,
      };
    }).immediate();

    res.status(201).json(resultado);
  });

  return router;
};
