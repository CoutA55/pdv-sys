const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// Caminho do banco. Pode ser trocado com a variável de ambiente PDV_DB.
const CAMINHO_PADRAO = process.env.PDV_DB || path.join(__dirname, 'data', 'pdv.db');

/**
 * Abre o banco SQLite já com as configurações que o PDV exige.
 * Use ':memory:' como caminho para um banco temporário (testes).
 */
function abrirBanco(caminho = CAMINHO_PADRAO) {
  if (caminho !== ':memory:') {
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
  }

  const db = new Database(caminho);

  // O SQLite NÃO liga as chaves estrangeiras sozinho: precisa em toda conexão.
  db.pragma('foreign_keys = ON');
  // WAL: leituras e escritas não se bloqueiam, e é mais seguro contra queda de energia.
  db.pragma('journal_mode = WAL');
  // Se o banco estiver ocupado, espera até 5 s antes de dar erro.
  db.pragma('busy_timeout = 5000');

  return db;
}

module.exports = { abrirBanco, CAMINHO_PADRAO };
