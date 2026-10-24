CREATE UNIQUE INDEX idx_caixa_sessoes_uma_aberta
  ON caixa_sessoes (fechado_em)
  WHERE fechado_em IS NULL;
