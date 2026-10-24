const express = require('express');
const { gerarRelatorio } = require('../relatorio-faturamento');

// GET /api/relatorios/faturamento?de=2026-10-01&ate=2026-10-21&agrupar=dia
// de e ate: AAAA-MM-DD (padrão: do dia 1 do mês até hoje).
// agrupar: "dia" ou "mes" (padrão: dia até 62 dias, mês acima disso).
module.exports = function rotasRelatorioFaturamento(db) {
  const router = express.Router();

  router.get('/faturamento', (req, res) => {
    res.json(gerarRelatorio(db, req.query));
  });

  return router;
};
