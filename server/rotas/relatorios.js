const express = require('express');
const { randomUUID } = require('node:crypto');
const { ErroDeRequisicao } = require('../erros');

const FORMAS_PAGAMENTO_FIADO = ['DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO'];

module.exports = function rotasRelatorios(db) {
  const router = express.Router();

  // GET /api/relatorios/fiado?limite=100
  router.get('/fiado', (req, res) => {
    const limiteSolicitado = Number.parseInt(req.query.limite, 10);
    const limite = Number.isInteger(limiteSolicitado)
      ? Math.min(Math.max(limiteSolicitado, 1), 200)
      : 100;

    const resumo = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN saldo_centavos > 0 THEN saldo_centavos ELSE 0 END), 0)
             AS total_a_receber_centavos,
           COUNT(CASE WHEN saldo_centavos > 0 THEN 1 END) AS clientes_devedores
         FROM saldo_fiado`
      )
      .get();

    const vendasResumo = db
      .prepare(
        `SELECT COUNT(DISTINCT v.id) AS quantidade_vendas_fiadas,
                COALESCE(SUM(p.valor_centavos), 0) AS total_vendas_fiadas_centavos
           FROM vendas v
           JOIN pagamentos p ON p.venda_id = v.id AND p.forma = 'FIADO'
          WHERE v.status = 'CONCLUIDA'`
      )
      .get();

    const clientes = db
      .prepare(
        `SELECT c.id, c.nome, c.telefone, s.saldo_centavos AS saldo_devedor_centavos
           FROM clientes c
           JOIN saldo_fiado s ON s.cliente_id = c.id
          WHERE s.saldo_centavos > 0
          ORDER BY s.saldo_centavos DESC, c.nome COLLATE NOCASE`
      )
      .all();

    const vendas = db
      .prepare(
        `SELECT v.id, v.criado_em, v.cliente_id, c.nome AS cliente_nome,
                v.total_centavos,
                SUM(p.valor_centavos) AS valor_fiado_centavos
           FROM vendas v
           JOIN clientes c ON c.id = v.cliente_id
           JOIN pagamentos p ON p.venda_id = v.id AND p.forma = 'FIADO'
          WHERE v.status = 'CONCLUIDA'
          GROUP BY v.id
          ORDER BY v.criado_em DESC, v.rowid DESC
          LIMIT ?`
      )
      .all(limite);

    res.json({
      resumo: {
        ...resumo,
        ...vendasResumo,
      },
      clientes,
      vendas,
      limite,
    });
  });

  router.post('/fiado/pagamentos', (req, res) => {
    const corpo = req.body ?? {};
    if (typeof corpo.cliente_id !== 'string' || !corpo.cliente_id.trim()) {
      throw new ErroDeRequisicao(400, 'Selecione o cliente que está pagando.');
    }
    if (!Number.isSafeInteger(corpo.valor_centavos) || corpo.valor_centavos <= 0) {
      throw new ErroDeRequisicao(400, 'O valor recebido deve ser um número inteiro de centavos maior que zero.');
    }
    if (!FORMAS_PAGAMENTO_FIADO.includes(corpo.forma_pagamento)) {
      throw new ErroDeRequisicao(400, `A forma de pagamento deve ser uma de: ${FORMAS_PAGAMENTO_FIADO.join(', ')}.`);
    }
    const observacao = String(corpo.observacao ?? '').trim() || null;

    const pagamento = db.transaction(() => {
      const sessao = db
        .prepare(
          `SELECT s.id, s.usuario_id
             FROM caixa_sessoes s
             JOIN usuarios u ON u.id = s.usuario_id AND u.ativo = 1
            WHERE s.fechado_em IS NULL`
        )
        .get();
      if (!sessao) {
        throw new ErroDeRequisicao(409, 'Abra o caixa antes de registrar o recebimento do fiado.');
      }

      const saldo = db
        .prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?')
        .get(corpo.cliente_id);
      if (!saldo || saldo.saldo_centavos <= 0) {
        throw new ErroDeRequisicao(404, 'Cliente sem saldo devedor em aberto.');
      }
      if (corpo.valor_centavos > saldo.saldo_centavos) {
        throw new ErroDeRequisicao(400, 'O valor recebido não pode ser maior que a dívida atual.');
      }

      const id = randomUUID();
      db.prepare(
        `INSERT INTO lancamentos_fiado
           (id, cliente_id, tipo, origem, valor_centavos, forma_pagamento,
            sessao_id, usuario_id, observacao)
         VALUES (?, ?, 'CREDITO', 'PAGAMENTO', ?, ?, ?, ?, ?)`
      ).run(
        id,
        corpo.cliente_id,
        corpo.valor_centavos,
        corpo.forma_pagamento,
        sessao.id,
        sessao.usuario_id,
        observacao
      );

      const saldoAtual = db
        .prepare('SELECT saldo_centavos FROM saldo_fiado WHERE cliente_id = ?')
        .get(corpo.cliente_id);
      return {
        id,
        cliente_id: corpo.cliente_id,
        valor_centavos: corpo.valor_centavos,
        forma_pagamento: corpo.forma_pagamento,
        sessao_id: sessao.id,
        saldo_devedor_centavos: saldoAtual.saldo_centavos,
      };
    }).immediate();

    res.status(201).json(pagamento);
  });

  return router;
};
