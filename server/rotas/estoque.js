const express = require('express');
const { randomUUID } = require('node:crypto');
const { ErroDeRequisicao } = require('../erros');

function textoOpcional(valor) {
  const texto = String(valor ?? '').trim();
  return texto || null;
}

function inteiroPositivo(valor, campo) {
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new ErroDeRequisicao(400, `${campo} deve ser um número inteiro maior que zero.`);
  }
  return valor;
}

// O estoque só muda por movimentações (livro-razão): nunca editamos um saldo.
module.exports = function rotasEstoque(db) {
  const router = express.Router();

  const buscarProdutoAtivo = (id) => {
    const produto =
      typeof id === 'string'
        ? db.prepare('SELECT id, nome FROM produtos WHERE id = ? AND ativo = 1').get(id)
        : undefined;
    if (!produto) throw new ErroDeRequisicao(404, 'Produto não encontrado.');
    return produto;
  };

  const saldoDe = (produtoId) =>
    db.prepare('SELECT quantidade_milesimos AS q FROM estoque_atual WHERE produto_id = ?').get(produtoId).q;

  // POST /api/estoque/entrada
  // { produto_id, quantidade_milesimos, custo_unitario_centavos?, observacao?, atualizar_custo_produto? }
  // Compra de mercadoria. 24 unidades = 24000.
  router.post('/entrada', (req, res) => {
    const corpo = req.body ?? {};
    const produto = buscarProdutoAtivo(corpo.produto_id);
    const quantidade = inteiroPositivo(corpo.quantidade_milesimos, 'quantidade_milesimos');
    const observacao = textoOpcional(corpo.observacao);

    let custo = null;
    if (corpo.custo_unitario_centavos !== undefined && corpo.custo_unitario_centavos !== null) {
      if (!Number.isInteger(corpo.custo_unitario_centavos) || corpo.custo_unitario_centavos < 0) {
        throw new ErroDeRequisicao(400, 'custo_unitario_centavos deve ser um número inteiro maior ou igual a zero.');
      }
      custo = corpo.custo_unitario_centavos;
    }

    // Opcional: usar este custo como o novo custo do cadastro do produto.
    const atualizarCusto = corpo.atualizar_custo_produto === true;
    if (atualizarCusto && custo === null) {
      throw new ErroDeRequisicao(400, 'Para atualizar o custo do produto, informe custo_unitario_centavos.');
    }

    const registrar = db.transaction(() => {
      db.prepare(
        `INSERT INTO movimentacoes_estoque
           (id, produto_id, tipo, quantidade_milesimos, custo_unitario_centavos, observacao)
         VALUES (?, ?, 'ENTRADA', ?, ?, ?)`
      ).run(randomUUID(), produto.id, quantidade, custo, observacao);

      if (atualizarCusto) {
        db.prepare(
          `UPDATE produtos
              SET preco_custo_centavos = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?`
        ).run(custo, produto.id);
      }
    });
    registrar();

    res.status(201).json({
      produto_id: produto.id,
      nome: produto.nome,
      estoque_milesimos: saldoDe(produto.id),
    });
  });

  // POST /api/estoque/ajuste
  // Informe UM destes:
  //   { quantidade_milesimos: -2000 }       diferença (negativo = perda/quebra)
  //   { saldo_contado_milesimos: 10000 }    contagem física (a API calcula a diferença)
  // E sempre o motivo em "observacao".
  router.post('/ajuste', (req, res) => {
    const corpo = req.body ?? {};
    const produto = buscarProdutoAtivo(corpo.produto_id);

    const observacao = textoOpcional(corpo.observacao);
    if (!observacao) {
      throw new ErroDeRequisicao(400, 'Informe o motivo do ajuste em "observacao".');
    }

    const temDiferenca = corpo.quantidade_milesimos !== undefined;
    const temContagem = corpo.saldo_contado_milesimos !== undefined;
    if (temDiferenca === temContagem) {
      throw new ErroDeRequisicao(
        400,
        'Informe quantidade_milesimos (diferença) OU saldo_contado_milesimos (contagem), mas não os dois.'
      );
    }

    const registrar = db.transaction(() => {
      let diferenca;

      if (temDiferenca) {
        if (!Number.isInteger(corpo.quantidade_milesimos) || corpo.quantidade_milesimos === 0) {
          throw new ErroDeRequisicao(400, 'quantidade_milesimos deve ser um número inteiro diferente de zero.');
        }
        diferenca = corpo.quantidade_milesimos;
      } else {
        if (!Number.isInteger(corpo.saldo_contado_milesimos) || corpo.saldo_contado_milesimos < 0) {
          throw new ErroDeRequisicao(400, 'saldo_contado_milesimos deve ser um número inteiro maior ou igual a zero.');
        }
        diferenca = corpo.saldo_contado_milesimos - saldoDe(produto.id);
        if (diferenca === 0) {
          throw new ErroDeRequisicao(400, 'A contagem é igual ao saldo atual: nada a ajustar.');
        }
      }

      db.prepare(
        `INSERT INTO movimentacoes_estoque
           (id, produto_id, tipo, quantidade_milesimos, observacao)
         VALUES (?, ?, 'AJUSTE', ?, ?)`
      ).run(randomUUID(), produto.id, diferenca, observacao);

      return diferenca;
    });
    const diferenca = registrar();

    res.status(201).json({
      produto_id: produto.id,
      nome: produto.nome,
      ajuste_milesimos: diferenca,
      estoque_milesimos: saldoDe(produto.id),
    });
  });

  // GET /api/estoque/movimentacoes?produto_id=...&limite=50
  // Histórico, da mais recente para a mais antiga.
  router.get('/movimentacoes', (req, res) => {
    const limite = Math.min(Number.parseInt(req.query.limite, 10) || 50, 200);

    const filtros = [];
    const parametros = [];
    if (req.query.produto_id) {
      filtros.push('m.produto_id = ?');
      parametros.push(String(req.query.produto_id));
    }
    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

    const movimentacoes = db
      .prepare(
        `SELECT m.id, m.produto_id, p.nome AS produto_nome, m.tipo,
                m.quantidade_milesimos, m.custo_unitario_centavos,
                m.venda_id, m.observacao, m.criado_em
           FROM movimentacoes_estoque m
           JOIN produtos p ON p.id = m.produto_id
           ${where}
          ORDER BY m.criado_em DESC, m.rowid DESC
          LIMIT ?`
      )
      .all(...parametros, limite);

    res.json(movimentacoes);
  });

  // GET /api/estoque/baixo
  // Produtos com estoque igual ou abaixo do mínimo.
  // Mínimo 0 no produto = usa o padrão da tabela configuracoes.
  router.get('/baixo', (req, res) => {
    const config = db
      .prepare("SELECT valor FROM configuracoes WHERE chave = 'estoque_minimo_padrao_milesimos'")
      .get();
    const padrao = Number.parseInt(config?.valor, 10) || 0;

    const produtos = db
      .prepare(
        `SELECT id, nome, unidade, estoque_milesimos, minimo_milesimos
           FROM (
             SELECT p.id, p.nome, p.unidade,
                    e.quantidade_milesimos AS estoque_milesimos,
                    CASE WHEN p.estoque_minimo_milesimos > 0
                         THEN p.estoque_minimo_milesimos ELSE ? END AS minimo_milesimos
               FROM produtos p
               JOIN estoque_atual e ON e.produto_id = p.id
              WHERE p.ativo = 1
           )
          WHERE estoque_milesimos <= minimo_milesimos
          ORDER BY nome`
      )
      .all(padrao);

    res.json(produtos);
  });

  return router;
};
