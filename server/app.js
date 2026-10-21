const express = require('express');
const rotasCategorias = require('./rotas/categorias');
const rotasProdutos = require('./rotas/produtos');
const rotasEstoque = require('./rotas/estoque');
const { ErroDeRequisicao } = require('./erros');

// Recebe o banco já aberto. Assim dá pra testar com banco em memória.
function criarApp(db) {
  const app = express();
  app.use(express.json());

  app.get('/api/saude', (req, res) => res.json({ ok: true }));
  app.use('/api/categorias', rotasCategorias(db));
  app.use('/api/produtos', rotasProdutos(db));
  app.use('/api/estoque', rotasEstoque(db));

  app.use('/api', (req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada.' });
  });

  // Tratamento central de erros: sempre responde em JSON { erro: "mensagem" }.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErroDeRequisicao) {
      return res.status(err.status).json({ erro: err.message });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ erro: 'JSON inválido.' });
    }
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ erro: 'Já existe um registro com esse valor (código de barras ou nome repetido).' });
    }
    if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(400).json({ erro: 'Dados inválidos.' });
    }

    console.error(err);
    res.status(500).json({ erro: 'Erro interno.' });
  });

  return app;
}

module.exports = { criarApp };
