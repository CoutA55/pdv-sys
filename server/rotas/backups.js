const express = require('express');
const { ErroDeRequisicao } = require('../erros');

module.exports = function rotasBackups(gerenciador) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(gerenciador.status());
  });

  router.put('/destino', (req, res) => {
    const volume = req.body?.volume;
    if (typeof volume !== 'string' || !volume.trim()) {
      throw new ErroDeRequisicao(400, 'Selecione um dispositivo de backup.');
    }
    try {
      res.json(gerenciador.configurarVolume(volume));
    } catch (erro) {
      throw new ErroDeRequisicao(409, erro.message);
    }
  });

  router.post('/', async (req, res) => {
    try {
      res.status(201).json(await gerenciador.criarBackup());
    } catch (erro) {
      if (erro.code === 'BACKUP_DESTINO_INDISPONIVEL') {
        throw new ErroDeRequisicao(409, erro.message);
      }
      throw erro;
    }
  });

  return router;
};
