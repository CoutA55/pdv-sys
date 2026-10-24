const express = require('express');
const { randomUUID } = require('node:crypto');
const { ErroDeRequisicao } = require('../erros');

module.exports = function rotasUsuarios(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const usuarios = db
      .prepare('SELECT id, nome, papel FROM usuarios WHERE ativo = 1 ORDER BY nome')
      .all();
    res.json(usuarios);
  });

  router.post('/', (req, res) => {
    const nome = String((req.body ?? {}).nome ?? '').trim();
    if (!nome) throw new ErroDeRequisicao(400, 'Informe o nome do operador.');

    const usuario = { id: randomUUID(), nome, papel: 'OPERADOR' };
    db.prepare('INSERT INTO usuarios (id, nome, papel) VALUES (?, ?, ?)').run(
      usuario.id,
      usuario.nome,
      usuario.papel
    );

    res.status(201).json(usuario);
  });

  return router;
};
