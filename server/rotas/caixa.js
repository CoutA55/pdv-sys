const express = require('express');
const { randomUUID } = require('node:crypto');
const { ErroDeRequisicao } = require('../erros');

function valorNaoNegativo(valor, campo) {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new ErroDeRequisicao(400, `${campo} deve ser um número inteiro maior ou igual a zero.`);
  }
  return valor;
}

function observacaoOpcional(valor) {
  const texto = String(valor ?? '').trim();
  return texto || null;
}

module.exports = function rotasCaixa(db) {
  const router = express.Router();

  function buscarSessaoAberta() {
    const sessao = db
      .prepare(
        `SELECT s.id, s.usuario_id, u.nome AS usuario_nome, s.aberto_em,
                s.valor_abertura_centavos, s.observacao
           FROM caixa_sessoes s
           JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.fechado_em IS NULL`
      )
      .get();

    if (!sessao) return null;

    const movimento = db
      .prepare(
        `SELECT
           COALESCE((
             SELECT SUM(p.valor_centavos)
               FROM pagamentos p
               JOIN vendas v ON v.id = p.venda_id
              WHERE v.sessao_id = ? AND p.forma = 'DINHEIRO'
           ), 0) AS vendas_dinheiro_centavos,
           COALESCE((
             SELECT SUM(valor_centavos) FROM (
               SELECT e.valor_centavos
                 FROM estornos_venda e
                WHERE e.sessao_id = ? AND e.forma = 'DINHEIRO'
               UNION ALL
               SELECT dp.valor_centavos
                 FROM devolucoes_venda_pagamentos dp
                 JOIN devolucoes_venda d ON d.id = dp.devolucao_id
                WHERE d.sessao_id = ? AND dp.forma = 'DINHEIRO'
             )
           ), 0) AS estornos_dinheiro_centavos,
           COALESCE((
             SELECT SUM(l.valor_centavos)
               FROM lancamentos_fiado l
              WHERE l.sessao_id = ? AND l.origem = 'PAGAMENTO'
                AND l.forma_pagamento = 'DINHEIRO'
           ), 0) AS recebimentos_fiado_dinheiro_centavos,
           COALESCE(SUM(CASE WHEN tipo = 'SUPRIMENTO' THEN valor_centavos
                             WHEN tipo = 'SANGRIA' THEN -valor_centavos
                             ELSE 0 END), 0) AS movimentacoes_centavos
           FROM movimentacoes_caixa
          WHERE sessao_id = ?`
      )
      .get(sessao.id, sessao.id, sessao.id, sessao.id, sessao.id);

    const saldoEsperado =
      sessao.valor_abertura_centavos +
      movimento.vendas_dinheiro_centavos +
      movimento.recebimentos_fiado_dinheiro_centavos -
      movimento.estornos_dinheiro_centavos +
      movimento.movimentacoes_centavos;

    return {
      ...sessao,
      vendas_dinheiro_centavos: movimento.vendas_dinheiro_centavos,
      recebimentos_fiado_dinheiro_centavos: movimento.recebimentos_fiado_dinheiro_centavos,
      estornos_dinheiro_centavos: movimento.estornos_dinheiro_centavos,
      movimentacoes_centavos: movimento.movimentacoes_centavos,
      saldo_esperado_centavos: saldoEsperado,
    };
  }

  router.get('/aberto', (req, res) => {
    res.json({ sessao: buscarSessaoAberta() });
  });

  router.post('/movimentacoes', (req, res) => {
    const corpo = req.body ?? {};
    if (corpo.tipo !== 'SANGRIA' && corpo.tipo !== 'SUPRIMENTO') {
      throw new ErroDeRequisicao(400, 'O tipo deve ser SANGRIA ou SUPRIMENTO.');
    }
    const valor = valorNaoNegativo(corpo.valor_centavos, 'valor_centavos');
    if (valor === 0) throw new ErroDeRequisicao(400, 'Informe um valor maior que zero.');
    const motivo = String(corpo.motivo ?? '').trim();
    if (!motivo) throw new ErroDeRequisicao(400, 'Informe o motivo da movimentação.');
    if (motivo.length > 500) throw new ErroDeRequisicao(400, 'O motivo deve ter no máximo 500 caracteres.');

    const movimento = db.transaction(() => {
      const sessao = buscarSessaoAberta();
      if (!sessao) throw new ErroDeRequisicao(409, 'Abra o caixa antes de registrar uma movimentação.');
      if (corpo.tipo === 'SANGRIA' && valor > sessao.saldo_esperado_centavos) {
        throw new ErroDeRequisicao(409, 'A sangria não pode ser maior que o saldo esperado em dinheiro.');
      }

      const id = randomUUID();
      db.prepare(
        `INSERT INTO movimentacoes_caixa (id, sessao_id, tipo, valor_centavos, motivo, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, sessao.id, corpo.tipo, valor, motivo, sessao.usuario_id);
      return { id, tipo: corpo.tipo, valor_centavos: valor, motivo };
    }).immediate();

    res.status(201).json({ ...movimento, sessao: buscarSessaoAberta() });
  });

  router.post('/abrir', (req, res) => {
    const corpo = req.body ?? {};
    if (typeof corpo.usuario_id !== 'string' || !corpo.usuario_id.trim()) {
      throw new ErroDeRequisicao(400, 'Informe o usuario_id do operador.');
    }
    const abertura = valorNaoNegativo(corpo.valor_abertura_centavos ?? 0, 'valor_abertura_centavos');
    const observacao = observacaoOpcional(corpo.observacao);

    db.transaction(() => {
      const usuario = db
        .prepare('SELECT id FROM usuarios WHERE id = ? AND ativo = 1')
        .get(corpo.usuario_id);
      if (!usuario) throw new ErroDeRequisicao(404, 'Operador não encontrado ou inativo.');
      if (buscarSessaoAberta()) {
        throw new ErroDeRequisicao(409, 'Já existe um caixa aberto.');
      }

      const id = randomUUID();
      db.prepare(
        `INSERT INTO caixa_sessoes (id, usuario_id, valor_abertura_centavos, observacao)
         VALUES (?, ?, ?, ?)`
      ).run(id, usuario.id, abertura, observacao);

      return id;
    }).immediate();

    res.status(201).json(buscarSessaoAberta());
  });

  router.post('/fechar', (req, res) => {
    const corpo = req.body ?? {};
    const contado = valorNaoNegativo(corpo.valor_contado_centavos, 'valor_contado_centavos');
    const observacao = observacaoOpcional(corpo.observacao);

    const fechar = db.transaction(() => {
      const sessao = buscarSessaoAberta();
      if (!sessao) throw new ErroDeRequisicao(409, 'Não há caixa aberto para fechar.');

      const resultado = db
        .prepare(
          `UPDATE caixa_sessoes
              SET fechado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                  valor_contado_centavos = ?,
                  observacao = CASE WHEN ? IS NULL THEN observacao ELSE ? END
            WHERE id = ? AND fechado_em IS NULL`
        )
        .run(contado, observacao, observacao, sessao.id);
      if (resultado.changes !== 1) {
        throw new ErroDeRequisicao(409, 'O caixa já foi fechado.');
      }

      return {
        sessao_id: sessao.id,
        valor_esperado_centavos: sessao.saldo_esperado_centavos,
        valor_contado_centavos: contado,
        diferenca_centavos: contado - sessao.saldo_esperado_centavos,
      };
    }).immediate();

    res.json(fechar);
  });

  return router;
};
