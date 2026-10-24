CREATE TABLE devolucoes_venda (
  id          TEXT PRIMARY KEY,
  venda_id    TEXT NOT NULL REFERENCES vendas (id),
  sessao_id   TEXT NOT NULL REFERENCES caixa_sessoes (id),
  usuario_id  TEXT NOT NULL REFERENCES usuarios (id),
  destino     TEXT NOT NULL CHECK (destino IN ('ESTOQUE', 'DESCARTE', 'SEM_ITEM')),
  motivo      TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_devolucoes_venda_venda ON devolucoes_venda (venda_id);
CREATE INDEX idx_devolucoes_venda_sessao ON devolucoes_venda (sessao_id);

CREATE TABLE devolucoes_venda_itens (
  id                    TEXT PRIMARY KEY,
  devolucao_id          TEXT NOT NULL REFERENCES devolucoes_venda (id),
  venda_item_id         TEXT NOT NULL REFERENCES venda_itens (id),
  quantidade_milesimos  INTEGER NOT NULL CHECK (quantidade_milesimos > 0),
  valor_centavos        INTEGER NOT NULL CHECK (valor_centavos > 0)
);

CREATE INDEX idx_devolucoes_itens_venda_item ON devolucoes_venda_itens (venda_item_id);

CREATE TABLE devolucoes_venda_pagamentos (
  id            TEXT PRIMARY KEY,
  devolucao_id  TEXT NOT NULL REFERENCES devolucoes_venda (id),
  pagamento_id  TEXT NOT NULL REFERENCES pagamentos (id),
  forma         TEXT NOT NULL CHECK (forma IN ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'FIADO')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0)
);

CREATE INDEX idx_devolucoes_pagamentos_pagamento ON devolucoes_venda_pagamentos (pagamento_id);
CREATE INDEX idx_devolucoes_pagamentos_devolucao ON devolucoes_venda_pagamentos (devolucao_id);

CREATE TRIGGER devolucoes_venda_sem_update
BEFORE UPDATE ON devolucoes_venda
BEGIN
  SELECT RAISE(ABORT, 'devolucoes_venda é imutável: faça um novo lançamento');
END;

CREATE TRIGGER devolucoes_venda_sem_delete
BEFORE DELETE ON devolucoes_venda
BEGIN
  SELECT RAISE(ABORT, 'devolucoes_venda é imutável: faça um novo lançamento');
END;

CREATE TRIGGER devolucoes_venda_itens_sem_update
BEFORE UPDATE ON devolucoes_venda_itens
BEGIN
  SELECT RAISE(ABORT, 'devolucoes_venda_itens é imutável: faça um novo lançamento');
END;

CREATE TRIGGER devolucoes_venda_itens_sem_delete
BEFORE DELETE ON devolucoes_venda_itens
BEGIN
  SELECT RAISE(ABORT, 'devolucoes_venda_itens é imutável: faça um novo lançamento');
END;

CREATE TRIGGER devolucoes_venda_pagamentos_sem_update
BEFORE UPDATE ON devolucoes_venda_pagamentos
BEGIN
  SELECT RAISE(ABORT, 'devolucoes_venda_pagamentos é imutável: faça um novo lançamento');
END;

CREATE TRIGGER devolucoes_venda_pagamentos_sem_delete
BEFORE DELETE ON devolucoes_venda_pagamentos
BEGIN
  SELECT RAISE(ABORT, 'devolucoes_venda_pagamentos é imutável: faça um novo lançamento');
END;
