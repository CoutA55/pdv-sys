-- 001_esquema_inicial.sql
-- PDV para mercadinho (SQLite)
--
-- Convenções:
--  * IDs: UUID em texto, gerado pela aplicação
--  * Dinheiro: inteiro em centavos (R$ 12,50 = 1250)
--  * Quantidades: inteiro em milésimos (1 un = 1000; 0,350 kg = 350)
--    Total do item = round(preco_unitario_centavos * quantidade_milesimos / 1000)
--  * Datas: texto ISO 8601 em UTC
--
-- Em TODA conexão, a aplicação deve rodar:
--   PRAGMA foreign_keys = ON;
--   PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------
-- Usuários (quem opera o caixa)
-- ---------------------------------------------------------------
CREATE TABLE usuarios (
  id        TEXT PRIMARY KEY,
  nome      TEXT NOT NULL,
  papel     TEXT NOT NULL DEFAULT 'OPERADOR' CHECK (papel IN ('ADMIN', 'OPERADOR')),
  pin_hash  TEXT,
  ativo     INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------
-- Categorias de produto (ex.: Mercearia, Bebidas, Frios)
-- ---------------------------------------------------------------
CREATE TABLE categorias (
  id    TEXT PRIMARY KEY,
  nome  TEXT NOT NULL UNIQUE,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

-- ---------------------------------------------------------------
-- Produtos
-- unidade: UN (unidade), KG (peso) ou L (litro)
-- estoque_minimo_milesimos: 0 = usa o padrão da tabela configuracoes
-- ---------------------------------------------------------------
CREATE TABLE produtos (
  id                       TEXT PRIMARY KEY,
  codigo_barras            TEXT UNIQUE,
  nome                     TEXT NOT NULL,
  categoria_id             TEXT REFERENCES categorias (id),
  unidade                  TEXT NOT NULL DEFAULT 'UN' CHECK (unidade IN ('UN', 'KG', 'L')),
  preco_custo_centavos     INTEGER NOT NULL DEFAULT 0 CHECK (preco_custo_centavos >= 0),
  preco_venda_centavos     INTEGER NOT NULL CHECK (preco_venda_centavos >= 0),
  estoque_minimo_milesimos INTEGER NOT NULL DEFAULT 0 CHECK (estoque_minimo_milesimos >= 0),
  ativo                    INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_produtos_nome ON produtos (nome);
CREATE INDEX idx_produtos_categoria ON produtos (categoria_id);

-- ---------------------------------------------------------------
-- Configurações gerais (chave/valor)
-- ---------------------------------------------------------------
CREATE TABLE configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT INTO configuracoes (chave, valor) VALUES ('estoque_minimo_padrao_milesimos', '0');

-- ---------------------------------------------------------------
-- Clientes (para o fiado)
-- limite_fiado_centavos NULL = sem limite
-- ---------------------------------------------------------------
CREATE TABLE clientes (
  id                    TEXT PRIMARY KEY,
  nome                  TEXT NOT NULL,
  telefone              TEXT,
  limite_fiado_centavos INTEGER CHECK (limite_fiado_centavos IS NULL OR limite_fiado_centavos >= 0),
  bloqueado             INTEGER NOT NULL DEFAULT 0 CHECK (bloqueado IN (0, 1)),
  ativo                 INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_clientes_nome ON clientes (nome);

-- ---------------------------------------------------------------
-- Caixa: cada abertura/fechamento é uma sessão
-- ---------------------------------------------------------------
CREATE TABLE caixa_sessoes (
  id                      TEXT PRIMARY KEY,
  usuario_id              TEXT NOT NULL REFERENCES usuarios (id),
  aberto_em               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  valor_abertura_centavos INTEGER NOT NULL DEFAULT 0 CHECK (valor_abertura_centavos >= 0),
  fechado_em              TEXT,
  valor_contado_centavos  INTEGER CHECK (valor_contado_centavos IS NULL OR valor_contado_centavos >= 0),
  observacao              TEXT
);

-- Sangria (retirada de dinheiro) e suprimento (entrada de troco)
CREATE TABLE movimentacoes_caixa (
  id           TEXT PRIMARY KEY,
  sessao_id    TEXT NOT NULL REFERENCES caixa_sessoes (id),
  tipo         TEXT NOT NULL CHECK (tipo IN ('SANGRIA', 'SUPRIMENTO')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  motivo       TEXT,
  usuario_id   TEXT REFERENCES usuarios (id),
  criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_mov_caixa_sessao ON movimentacoes_caixa (sessao_id);

-- ---------------------------------------------------------------
-- Vendas
-- Venda cancelada continua gravada (status CANCELADA); nunca é apagada.
-- ---------------------------------------------------------------
CREATE TABLE vendas (
  id                   TEXT PRIMARY KEY,
  sessao_id            TEXT NOT NULL REFERENCES caixa_sessoes (id),
  usuario_id           TEXT NOT NULL REFERENCES usuarios (id),
  cliente_id           TEXT REFERENCES clientes (id),
  status               TEXT NOT NULL DEFAULT 'CONCLUIDA' CHECK (status IN ('CONCLUIDA', 'CANCELADA')),
  subtotal_centavos    INTEGER NOT NULL CHECK (subtotal_centavos >= 0),
  desconto_centavos    INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  total_centavos       INTEGER NOT NULL CHECK (total_centavos >= 0),
  criado_em            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  cancelada_em         TEXT,
  motivo_cancelamento  TEXT,
  CHECK (total_centavos = subtotal_centavos - desconto_centavos)
);

CREATE INDEX idx_vendas_sessao ON vendas (sessao_id);
CREATE INDEX idx_vendas_criado_em ON vendas (criado_em);
CREATE INDEX idx_vendas_cliente ON vendas (cliente_id);

-- Itens: guardam nome e preço da hora da venda (o cadastro pode mudar depois)
CREATE TABLE venda_itens (
  id                      TEXT PRIMARY KEY,
  venda_id                TEXT NOT NULL REFERENCES vendas (id),
  produto_id              TEXT NOT NULL REFERENCES produtos (id),
  descricao               TEXT NOT NULL,
  quantidade_milesimos    INTEGER NOT NULL CHECK (quantidade_milesimos > 0),
  preco_unitario_centavos INTEGER NOT NULL CHECK (preco_unitario_centavos >= 0),
  desconto_centavos       INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  total_centavos          INTEGER NOT NULL CHECK (total_centavos >= 0)
);

CREATE INDEX idx_venda_itens_venda ON venda_itens (venda_id);
CREATE INDEX idx_venda_itens_produto ON venda_itens (produto_id);

-- Pagamentos: uma venda pode ter vários (venda mista).
-- valor_centavos = quanto foi abatido da venda.
-- troco_centavos = troco devolvido (só faz sentido em DINHEIRO).
-- Dinheiro recebido do cliente = valor_centavos + troco_centavos.
CREATE TABLE pagamentos (
  id             TEXT PRIMARY KEY,
  venda_id       TEXT NOT NULL REFERENCES vendas (id),
  forma          TEXT NOT NULL CHECK (forma IN ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'FIADO')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  troco_centavos INTEGER NOT NULL DEFAULT 0 CHECK (troco_centavos >= 0),
  CHECK (troco_centavos = 0 OR forma = 'DINHEIRO')
);

CREATE INDEX idx_pagamentos_venda ON pagamentos (venda_id);

-- ---------------------------------------------------------------
-- Estoque: livro-razão. O saldo é a soma das movimentações.
-- quantidade_milesimos: positivo entra, negativo sai.
-- Registros nunca são editados nem apagados (veja os triggers abaixo).
-- Correção = novo lançamento (AJUSTE ou ESTORNO_VENDA).
-- ---------------------------------------------------------------
CREATE TABLE movimentacoes_estoque (
  id                      TEXT PRIMARY KEY,
  produto_id              TEXT NOT NULL REFERENCES produtos (id),
  tipo                    TEXT NOT NULL CHECK (tipo IN ('ENTRADA', 'SAIDA_VENDA', 'ESTORNO_VENDA', 'AJUSTE')),
  quantidade_milesimos    INTEGER NOT NULL CHECK (quantidade_milesimos <> 0),
  custo_unitario_centavos INTEGER CHECK (custo_unitario_centavos IS NULL OR custo_unitario_centavos >= 0),
  venda_id                TEXT REFERENCES vendas (id),
  usuario_id              TEXT REFERENCES usuarios (id),
  observacao              TEXT,
  criado_em               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (tipo IN ('ENTRADA', 'ESTORNO_VENDA') AND quantidade_milesimos > 0)
    OR (tipo = 'SAIDA_VENDA' AND quantidade_milesimos < 0)
    OR tipo = 'AJUSTE'
  )
);

CREATE INDEX idx_mov_estoque_produto ON movimentacoes_estoque (produto_id);
CREATE INDEX idx_mov_estoque_venda ON movimentacoes_estoque (venda_id);

-- ---------------------------------------------------------------
-- Fiado: livro-razão por cliente. O saldo devedor é a soma:
-- DEBITO aumenta a dívida, CREDITO diminui.
-- origem explica de onde veio o lançamento.
-- ---------------------------------------------------------------
CREATE TABLE lancamentos_fiado (
  id               TEXT PRIMARY KEY,
  cliente_id       TEXT NOT NULL REFERENCES clientes (id),
  tipo             TEXT NOT NULL CHECK (tipo IN ('DEBITO', 'CREDITO')),
  origem           TEXT NOT NULL CHECK (origem IN ('VENDA', 'PAGAMENTO', 'ESTORNO', 'AJUSTE')),
  valor_centavos   INTEGER NOT NULL CHECK (valor_centavos > 0),
  venda_id         TEXT REFERENCES vendas (id),
  forma_pagamento  TEXT CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO')),
  sessao_id        TEXT REFERENCES caixa_sessoes (id),
  usuario_id       TEXT REFERENCES usuarios (id),
  observacao       TEXT,
  criado_em        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (origem = 'VENDA' AND tipo = 'DEBITO')
    OR (origem IN ('PAGAMENTO', 'ESTORNO') AND tipo = 'CREDITO')
    OR origem = 'AJUSTE'
  )
);

CREATE INDEX idx_fiado_cliente ON lancamentos_fiado (cliente_id);
CREATE INDEX idx_fiado_venda ON lancamentos_fiado (venda_id);

-- ---------------------------------------------------------------
-- Visões (saldos calculados, nunca editados à mão)
-- ---------------------------------------------------------------
CREATE VIEW estoque_atual AS
SELECT p.id AS produto_id,
       COALESCE(SUM(m.quantidade_milesimos), 0) AS quantidade_milesimos
FROM produtos p
LEFT JOIN movimentacoes_estoque m ON m.produto_id = p.id
GROUP BY p.id;

CREATE VIEW saldo_fiado AS
SELECT c.id AS cliente_id,
       COALESCE(SUM(CASE l.tipo WHEN 'DEBITO' THEN l.valor_centavos ELSE -l.valor_centavos END), 0) AS saldo_centavos
FROM clientes c
LEFT JOIN lancamentos_fiado l ON l.cliente_id = c.id
GROUP BY c.id;

-- ---------------------------------------------------------------
-- Proteção dos livros-razão: sem UPDATE nem DELETE
-- ---------------------------------------------------------------
CREATE TRIGGER movimentacoes_estoque_sem_update
BEFORE UPDATE ON movimentacoes_estoque
BEGIN
  SELECT RAISE(ABORT, 'movimentacoes_estoque é imutável: faça um novo lançamento');
END;

CREATE TRIGGER movimentacoes_estoque_sem_delete
BEFORE DELETE ON movimentacoes_estoque
BEGIN
  SELECT RAISE(ABORT, 'movimentacoes_estoque é imutável: faça um novo lançamento');
END;

CREATE TRIGGER lancamentos_fiado_sem_update
BEFORE UPDATE ON lancamentos_fiado
BEGIN
  SELECT RAISE(ABORT, 'lancamentos_fiado é imutável: faça um novo lançamento');
END;

CREATE TRIGGER lancamentos_fiado_sem_delete
BEFORE DELETE ON lancamentos_fiado
BEGIN
  SELECT RAISE(ABORT, 'lancamentos_fiado é imutável: faça um novo lançamento');
END;
