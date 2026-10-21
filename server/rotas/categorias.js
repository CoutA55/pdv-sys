const express = require('express');
const { randomUUID } = require('node:crypto');
const { ErroDeRequisicao } = require('../erros');

module.exports = function rotasCategorias(db) {
  const router = express.Router();

  // GET /api/categorias
  router.get('/', (req, res) => {
    const categorias = db
      .prepare('SELECT id, nome FROM categorias WHERE ativo = 1 ORDER BY nome')
      .all();
    res.json(categorias);
  });

  // POST /api/categorias   { "nome": "Bebidas" }
  router.post('/', (req, res) => {
    const nome = String((req.body ?? {}).nome ?? '').trim();
    if (!nome) {
      throw new ErroDeRequisicao(400, 'Informe o nome da categoria.');
    }

    const id = randomUUID();
    db.prepare('INSERT INTO categorias (id, nome) VALUES (?, ?)').run(id, nome);
    res.status(201).json({ id, nome });
  });

  return router;
};
