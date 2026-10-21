// Testa o esquema do banco usando um banco temporário em memória.
// Não mexe no banco real. Rode com: npm run testar-banco

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { abrirBanco } = require('../db');
const { migrar } = require('../migrate');

const db = abrirBanco(':memory:');
let total = 0;

function teste(nome, fn) {
  fn();
  total++;
  console.log(`OK  ${nome}`);
}

function deveFalhar(nome, fn) {
  let falhou = false;
  try {
    fn();
  } catch {
    falhou = true;
  }
  assert.equal(falhou, true, `Deveria ter sido bloqueado: ${nome}`);
  total++;
  console.log(`OK  ${nome} (bloqueado, como esperado)`);
}

const estoqueDe = (produtoId) =>
  db.prepare('SELECT quantidade_milesimos AS q FROM estoque_atual WHERE produto_id = ?').get(produtoId).q;

const saldoDe = (clienteId) =>
  db.prepare('SELECT saldo_centavos AS s FROM saldo_fiado WHERE cliente_id = ?').get(clienteId).s;

// ---------------------------------------------------------------
// Migrações
// ---------------------------------------------------------------
teste('aplica as migrações', () => {
  const aplicadas = migrar(db);
  assert.ok(aplicadas.length >= 1);
});

teste('rodar de novo não aplica nada (idempotente)', () => {
  assert.deepEqual(migrar(db), []);
});

// ---------------------------------------------------------------
// Dados de base
// ---------------------------------------------------------------
const usuarioId = randomUUID();
const categoriaId = randomUUID();
const produtoId = randomUUID();
const sessaoId = randomUUID();
const clienteId = randomUUID();

db.prepare('INSERT INTO usuarios (id, nome, papel) VALUES (?, ?, ?)').run(usuarioId, 'Operador Teste', 'OPERADOR');
db.prepare('INSERT INTO categorias (id, nome) VALUES (?, ?)').run(categoriaId, 'Bebidas');
db.prepare(
  `INSERT INTO produtos (id, codigo_barras, nome, categoria_id, unidade, preco_custo_centavos, preco_venda_centavos)
   VALUES (?, ?, ?, ?, 'UN', 600, 1000)`
).run(produtoId, '7890000000017', 'Refrigerante 2L', categoriaId);
db.prepare('INSERT INTO caixa_sessoes (id, usuario_id, valor_abertura_centavos) VALUES (?, ?, 5000)').run(sessaoId, usuarioId);
db.prepare('INSERT INTO clientes (id, nome, telefone) VALUES (?, ?, ?)').run(clienteId, 'Cliente Teste', '31999990000');

// ---------------------------------------------------------------
// Estoque
// ---------------------------------------------------------------
teste('entrada de 24 unidades (24000 milésimos)', () => {
  db.prepare(
    `INSERT INTO movimentacoes_estoque (id, produto_id, tipo, quantidade_milesimos, custo_unitario_centavos, usuario_id)
     VALUES (?, ?, 'ENTRADA', 24000, 600, ?)`
  ).run(randomUUID(), produtoId, usuarioId);
  assert.equal(estoqueDe(produtoId), 24000);
});

// ---------------------------------------------------------------
// Venda: tudo dentro de uma transação
// ---------------------------------------------------------------
const registrarVenda = db.transaction(() => {
  const vendaId = randomUUID();
  db.prepare(
    `INSERT INTO vendas (id, sessao_id, usuario_id, subtotal_centavos, desconto_centavos, total_centavos)
     VALUES (?, ?, ?, 8000, 0, 8000)`
  ).run(vendaId, sessaoId, usuarioId);
  db.prepare(
    `INSERT INTO venda_itens (id, venda_id, produto_id, descricao, quantidade_milesimos, preco_unitario_centavos, desconto_centavos, total_centavos)
     VALUES (?, ?, ?, 'Refrigerante 2L', 8000, 1000, 0, 8000)`
  ).run(randomUUID(), vendaId, produtoId);
  // Cliente deu R$ 100,00 em dinheiro: valor 8000 + troco 2000.
  db.prepare(
    `INSERT INTO pagamentos (id, venda_id, forma, valor_centavos, troco_centavos)
     VALUES (?, ?, 'DINHEIRO', 8000, 2000)`
  ).run(randomUUID(), vendaId);
  db.prepare(
    `INSERT INTO movimentacoes_estoque (id, produto_id, tipo, quantidade_milesimos, venda_id, usuario_id)
     VALUES (?, ?, 'SAIDA_VENDA', -8000, ?, ?)`
  ).run(randomUUID(), produtoId, vendaId, usuarioId);
  return vendaId;
});

teste('venda de 8 unidades baixa o estoque (24 → 16)', () => {
  registrarVenda();
  assert.equal(estoqueDe(produtoId), 16000);
  const venda = db.prepare('SELECT total_centavos AS t, status FROM vendas').get();
  assert.equal(venda.t, 8000);
  assert.equal(venda.status, 'CONCLUIDA');
});

teste('venda que falha no meio é desfeita por inteiro (rollback)', () => {
  const antes = db.prepare('SELECT COUNT(*) AS n FROM vendas').get().n;
  const vendaComErro = db.transaction(() => {
    const vendaId = randomUUID();
    db.prepare(
      `INSERT INTO vendas (id, sessao_id, usuario_id, subtotal_centavos, desconto_centavos, total_centavos)
       VALUES (?, ?, ?, 1000, 0, 1000)`
    ).run(vendaId, sessaoId, usuarioId);
    // Produto inexistente: tem que falhar e desfazer a venda acima.
    db.prepare(
      `INSERT INTO venda_itens (id, venda_id, produto_id, descricao, quantidade_milesimos, preco_unitario_centavos, total_centavos)
       VALUES (?, ?, ?, 'Fantasma', 1000, 1000, 1000)`
    ).run(randomUUID(), vendaId, randomUUID());
  });
  assert.throws(vendaComErro);
  const depois = db.prepare('SELECT COUNT(*) AS n FROM vendas').get().n;
  assert.equal(depois, antes);
});

// ---------------------------------------------------------------
// Fiado
// ---------------------------------------------------------------
teste('fiado: débito de R$ 50,00 e pagamento de R$ 20,00 deixam saldo de R$ 30,00', () => {
  db.prepare(
    `INSERT INTO lancamentos_fiado (id, cliente_id, tipo, origem, valor_centavos, usuario_id)
     VALUES (?, ?, 'DEBITO', 'VENDA', 5000, ?)`
  ).run(randomUUID(), clienteId, usuarioId);
  db.prepare(
    `INSERT INTO lancamentos_fiado (id, cliente_id, tipo, origem, valor_centavos, forma_pagamento, sessao_id, usuario_id)
     VALUES (?, ?, 'CREDITO', 'PAGAMENTO', 2000, 'PIX', ?, ?)`
  ).run(randomUUID(), clienteId, sessaoId, usuarioId);
  assert.equal(saldoDe(clienteId), 3000);
});

// ---------------------------------------------------------------
// Proteções do banco
// ---------------------------------------------------------------
deveFalhar('editar uma movimentação de estoque', () => {
  db.prepare('UPDATE movimentacoes_estoque SET quantidade_milesimos = 1 WHERE produto_id = ?').run(produtoId);
});

deveFalhar('apagar um lançamento de fiado', () => {
  db.prepare('DELETE FROM lancamentos_fiado WHERE cliente_id = ?').run(clienteId);
});

deveFalhar('saída de venda com quantidade positiva', () => {
  db.prepare(
    `INSERT INTO movimentacoes_estoque (id, produto_id, tipo, quantidade_milesimos)
     VALUES (?, ?, 'SAIDA_VENDA', 1000)`
  ).run(randomUUID(), produtoId);
});

deveFalhar('código de barras repetido', () => {
  db.prepare(
    `INSERT INTO produtos (id, codigo_barras, nome, preco_venda_centavos)
     VALUES (?, '7890000000017', 'Outro produto', 500)`
  ).run(randomUUID());
});

deveFalhar('venda com total diferente de subtotal - desconto', () => {
  db.prepare(
    `INSERT INTO vendas (id, sessao_id, usuario_id, subtotal_centavos, desconto_centavos, total_centavos)
     VALUES (?, ?, ?, 1000, 100, 1000)`
  ).run(randomUUID(), sessaoId, usuarioId);
});

deveFalhar('troco em pagamento que não é dinheiro', () => {
  const vendaId = db.prepare('SELECT id FROM vendas LIMIT 1').get().id;
  db.prepare(
    `INSERT INTO pagamentos (id, venda_id, forma, valor_centavos, troco_centavos)
     VALUES (?, ?, 'PIX', 1000, 500)`
  ).run(randomUUID(), vendaId);
});

console.log(`\n${total} verificações passaram. O esquema está funcionando.`);
db.close();
