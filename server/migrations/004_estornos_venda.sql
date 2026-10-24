ALTER TABLE vendas ADD COLUMN cancelada_por_usuario_id TEXT REFERENCES usuarios (id);
ALTER TABLE vendas ADD COLUMN cancelada_sessao_id TEXT REFERENCES caixa_sessoes (id);

CREATE TABLE estornos_venda (
  id           TEXT PRIMARY KEY,
  venda_id     TEXT NOT NULL REFERENCES vendas (id),
  pagamento_id TEXT NOT NULL UNIQUE REFERENCES pagamentos (id),
  forma        TEXT NOT NULL CHECK (forma IN ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'FIADO')),
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  sessao_id    TEXT NOT NULL REFERENCES caixa_sessoes (id),
  usuario_id   TEXT NOT NULL REFERENCES usuarios (id),
  motivo       TEXT NOT NULL,
  criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_estornos_venda_sessao ON estornos_venda (sessao_id);
CREATE INDEX idx_estornos_venda_venda ON estornos_venda (venda_id);

CREATE TRIGGER estornos_venda_sem_update
BEFORE UPDATE ON estornos_venda
BEGIN
  SELECT RAISE(ABORT, 'estornos_venda é imutável: faça um novo lançamento');
END;

CREATE TRIGGER estornos_venda_sem_delete
BEFORE DELETE ON estornos_venda
BEGIN
  SELECT RAISE(ABORT, 'estornos_venda é imutável: faça um novo lançamento');
END;
