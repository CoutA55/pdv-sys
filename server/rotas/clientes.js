const express = require('express');
const { randomUUID } = require('node:crypto');
const { ErroDeRequisicao } = require('../erros');

module.exports = function rotasClientes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const clientes = db
      .prepare(
        `SELECT id, nome, telefone
           FROM clientes
          WHERE ativo = 1 AND bloqueado = 0
          ORDER BY nome COLLATE NOCASE`
      )
      .all();
    res.json(clientes);
  });

  router.get('/todos', (req, res) => {
    const clientes = db.prepare(
      `SELECT c.id, c.nome, c.telefone, c.ativo, c.bloqueado,
              s.saldo_centavos AS saldo_devedor_centavos
         FROM clientes c
         JOIN saldo_fiado s ON s.cliente_id = c.id
        ORDER BY c.nome COLLATE NOCASE`
    ).all();
    res.json(clientes);
  });

  router.get('/:id/extrato', (req, res) => {
    const cliente = db.prepare(
      `SELECT c.id, c.nome, c.telefone, s.saldo_centavos AS saldo_devedor_centavos
         FROM clientes c
         JOIN saldo_fiado s ON s.cliente_id = c.id
        WHERE c.id = ?`
    ).get(req.params.id);
    if (!cliente) throw new ErroDeRequisicao(404, 'Cliente não encontrado.');

    const limiteSolicitado = Number.parseInt(req.query.limite, 10);
    const limite = Number.isInteger(limiteSolicitado)
      ? Math.min(Math.max(limiteSolicitado, 1), 200)
      : 100;
    const deslocamentoSolicitado = Number.parseInt(req.query.deslocamento, 10);
    const deslocamento = Number.isInteger(deslocamentoSolicitado)
      ? Math.max(deslocamentoSolicitado, 0)
      : 0;
    const totalLancamentos = db.prepare(
      'SELECT COUNT(*) AS total FROM lancamentos_fiado WHERE cliente_id = ?'
    ).get(cliente.id).total;

    const lancamentos = db.prepare(
      `WITH extrato AS (
         SELECT l.rowid AS ordem, l.id, l.tipo, l.origem, l.valor_centavos,
                l.forma_pagamento, l.observacao, l.criado_em, l.venda_id,
                u.nome AS operador_nome, v.status AS venda_status,
                v.total_centavos AS venda_total_centavos,
                (SELECT group_concat(i.descricao, ', ')
                   FROM venda_itens i WHERE i.venda_id = l.venda_id) AS itens_venda,
                SUM(CASE l.tipo WHEN 'DEBITO' THEN l.valor_centavos ELSE -l.valor_centavos END)
                  OVER (ORDER BY l.criado_em, l.rowid
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo_apos_centavos
           FROM lancamentos_fiado l
           LEFT JOIN usuarios u ON u.id = l.usuario_id
           LEFT JOIN vendas v ON v.id = l.venda_id
          WHERE l.cliente_id = ?
       )
       SELECT id, tipo, origem, valor_centavos, forma_pagamento, observacao,
              criado_em, venda_id, venda_status, venda_total_centavos, itens_venda,
              operador_nome, saldo_apos_centavos
         FROM extrato
        ORDER BY criado_em DESC, ordem DESC
        LIMIT ? OFFSET ?`
    ).all(cliente.id, limite, deslocamento);

    res.json({
      cliente,
      lancamentos,
      total_lancamentos: totalLancamentos,
      proximo_deslocamento: deslocamento + lancamentos.length < totalLancamentos
        ? deslocamento + lancamentos.length
        : null,
    });
  });

  router.post('/', (req, res) => {
    const corpo = req.body ?? {};
    const nome = String(corpo.nome ?? '').trim();
    const telefone = String(corpo.telefone ?? '').trim() || null;
    if (!nome) throw new ErroDeRequisicao(400, 'Informe o nome do cliente.');

    const cliente = { id: randomUUID(), nome, telefone };
    db.prepare('INSERT INTO clientes (id, nome, telefone) VALUES (@id, @nome, @telefone)').run(cliente);
    res.status(201).json(cliente);
  });

  return router;
};
