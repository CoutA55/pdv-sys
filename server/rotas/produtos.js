const express = require('express');
const { randomUUID } = require('node:crypto');
const { ErroDeRequisicao } = require('../erros');

const UNIDADES = ['UN', 'KG', 'L'];

// Dinheiro sempre em centavos e quantidades em milésimos (inteiros).
// A conversão para R$ e para "2,5 kg" é feita na tela, não aqui.
const SELECT_PRODUTO = `
  SELECT p.id, p.codigo_barras, p.nome, p.categoria_id, p.unidade,
         p.preco_custo_centavos, p.preco_venda_centavos,
         p.estoque_minimo_milesimos, p.ativo,
         e.quantidade_milesimos AS estoque_milesimos
  FROM produtos p
  JOIN estoque_atual e ON e.produto_id = p.id
`;

function inteiro(valor, campo) {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new ErroDeRequisicao(400, `${campo} deve ser um número inteiro maior ou igual a zero.`);
  }
  return valor;
}

// Valida o corpo da requisição e devolve só os campos permitidos.
// criacao = true exige nome e preço de venda.
function lerProduto(db, corpo, criacao) {
  const dados = {};

  if (criacao || corpo.nome !== undefined) {
    const nome = String(corpo.nome ?? '').trim();
    if (!nome) throw new ErroDeRequisicao(400, 'Informe o nome do produto.');
    dados.nome = nome;
  }

  if (corpo.codigo_barras !== undefined) {
    const codigo = String(corpo.codigo_barras ?? '').trim();
    dados.codigo_barras = codigo || null; // vazio vira "sem código"
  }

  if (corpo.unidade !== undefined) {
    if (!UNIDADES.includes(corpo.unidade)) {
      throw new ErroDeRequisicao(400, `unidade deve ser uma de: ${UNIDADES.join(', ')}.`);
    }
    dados.unidade = corpo.unidade;
  }

  if (corpo.categoria_id !== undefined) {
    if (corpo.categoria_id === null) {
      dados.categoria_id = null;
    } else {
      const existe =
        typeof corpo.categoria_id === 'string' &&
        db.prepare('SELECT 1 FROM categorias WHERE id = ? AND ativo = 1').get(corpo.categoria_id);
      if (!existe) throw new ErroDeRequisicao(400, 'Categoria não encontrada.');
      dados.categoria_id = corpo.categoria_id;
    }
  }

  if (criacao || corpo.preco_venda_centavos !== undefined) {
    dados.preco_venda_centavos = inteiro(corpo.preco_venda_centavos, 'preco_venda_centavos');
  }
  if (corpo.preco_custo_centavos !== undefined) {
    dados.preco_custo_centavos = inteiro(corpo.preco_custo_centavos, 'preco_custo_centavos');
  }
  if (corpo.estoque_minimo_milesimos !== undefined) {
    dados.estoque_minimo_milesimos = inteiro(corpo.estoque_minimo_milesimos, 'estoque_minimo_milesimos');
  }

  if (!criacao && corpo.ativo !== undefined) {
    dados.ativo = corpo.ativo ? 1 : 0;
  }

  return dados;
}

module.exports = function rotasProdutos(db) {
  const router = express.Router();

  const buscarPorId = (id) => db.prepare(`${SELECT_PRODUTO} WHERE p.id = ?`).get(id);

  // GET /api/produtos?busca=refri&limite=20
  // Procura por parte do nome ou pelo código de barras exato.
  router.get('/', (req, res) => {
    const busca = String(req.query.busca ?? '').trim();
    const limite = Math.min(Number.parseInt(req.query.limite, 10) || 50, 200);
    const incluirInativos = req.query.inativos === '1';

    const filtros = [];
    const parametros = [];

    if (!incluirInativos) filtros.push('p.ativo = 1');

    if (busca) {
      // Escapa % e _ para que sejam tratados como texto comum.
      const padrao = `%${busca.replace(/[\\%_]/g, '\\$&')}%`;
      filtros.push("(p.nome LIKE ? ESCAPE '\\' OR p.codigo_barras = ?)");
      parametros.push(padrao, busca);
    }

    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
    const produtos = db
      .prepare(`${SELECT_PRODUTO} ${where} ORDER BY p.nome LIMIT ?`)
      .all(...parametros, limite);

    res.json(produtos);
  });

  // GET /api/produtos/codigo/7890000000017
  // É o que a tela de venda chama quando o leitor bipa um código.
  router.get('/codigo/:codigo', (req, res) => {
    const produto = db
      .prepare(`${SELECT_PRODUTO} WHERE p.codigo_barras = ? AND p.ativo = 1`)
      .get(req.params.codigo);

    if (!produto) throw new ErroDeRequisicao(404, 'Produto não encontrado.');
    res.json(produto);
  });

  // GET /api/produtos/:id
  router.get('/:id', (req, res) => {
    const produto = buscarPorId(req.params.id);
    if (!produto) throw new ErroDeRequisicao(404, 'Produto não encontrado.');
    res.json(produto);
  });

  // POST /api/produtos
  // Se vier estoque_inicial_milesimos, vira uma movimentação de ENTRADA.
  router.post('/', (req, res) => {
    const corpo = req.body ?? {};
    const dados = lerProduto(db, corpo, true);

    let estoqueInicial = 0;
    if (corpo.estoque_inicial_milesimos !== undefined) {
      estoqueInicial = inteiro(corpo.estoque_inicial_milesimos, 'estoque_inicial_milesimos');
    }

    const id = randomUUID();
    const produto = {
      codigo_barras: null,
      categoria_id: null,
      unidade: 'UN',
      preco_custo_centavos: 0,
      estoque_minimo_milesimos: 0,
      ...dados,
      id,
    };

    // Produto e estoque inicial entram juntos, ou nenhum dos dois.
    const criar = db.transaction(() => {
      db.prepare(
        `INSERT INTO produtos
           (id, codigo_barras, nome, categoria_id, unidade,
            preco_custo_centavos, preco_venda_centavos, estoque_minimo_milesimos)
         VALUES
           (@id, @codigo_barras, @nome, @categoria_id, @unidade,
            @preco_custo_centavos, @preco_venda_centavos, @estoque_minimo_milesimos)`
      ).run(produto);

      if (estoqueInicial > 0) {
        db.prepare(
          `INSERT INTO movimentacoes_estoque
             (id, produto_id, tipo, quantidade_milesimos, custo_unitario_centavos, observacao)
           VALUES (?, ?, 'ENTRADA', ?, ?, 'Estoque inicial')`
        ).run(randomUUID(), id, estoqueInicial, produto.preco_custo_centavos || null);
      }
    });
    criar();

    res.status(201).json(buscarPorId(id));
  });

  // PATCH /api/produtos/:id   (só os campos que quiser mudar)
  // O estoque NÃO muda por aqui: use entrada e ajuste (próxima etapa).
  router.patch('/:id', (req, res) => {
    const dados = lerProduto(db, req.body ?? {}, false);
    const colunas = Object.keys(dados);
    if (colunas.length === 0) {
      throw new ErroDeRequisicao(400, 'Nenhum campo para atualizar.');
    }

    // Os nomes das colunas vêm de lerProduto (lista fixa), nunca direto do cliente.
    const alteracoes = colunas.map((coluna) => `${coluna} = @${coluna}`).join(', ');
    const resultado = db
      .prepare(
        `UPDATE produtos
            SET ${alteracoes}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = @id`
      )
      .run({ ...dados, id: req.params.id });

    if (resultado.changes === 0) throw new ErroDeRequisicao(404, 'Produto não encontrado.');
    res.json(buscarPorId(req.params.id));
  });

  // DELETE /api/produtos/:id
  // Não apaga: marca como inativo, para preservar o histórico de vendas.
  router.delete('/:id', (req, res) => {
    const resultado = db
      .prepare(
        `UPDATE produtos
            SET ativo = 0, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?`
      )
      .run(req.params.id);

    if (resultado.changes === 0) throw new ErroDeRequisicao(404, 'Produto não encontrado.');
    res.status(204).end();
  });

  return router;
};
