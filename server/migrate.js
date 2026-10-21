const fs = require('node:fs');
const path = require('node:path');

const PASTA_PADRAO = path.join(__dirname, 'migrations');

/**
 * Aplica, em ordem, os arquivos .sql da pasta de migrações que ainda não
 * foram aplicados. Cada arquivo roda dentro de uma transação: ou aplica
 * inteiro, ou não aplica nada.
 *
 * Regra de ouro: NUNCA edite uma migração que já foi aplicada.
 * Para mudar o banco, crie um arquivo novo (002_..., 003_...).
 *
 * Retorna a lista de arquivos aplicados nesta chamada.
 */
function migrar(db, pasta = PASTA_PADRAO) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migracoes (
      nome        TEXT PRIMARY KEY,
      aplicada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const jaAplicadas = new Set(
    db.prepare('SELECT nome FROM _migracoes').all().map((linha) => linha.nome)
  );

  const arquivos = fs
    .readdirSync(pasta)
    .filter((arquivo) => /^\d+.*\.sql$/.test(arquivo))
    .sort();

  const registrar = db.prepare('INSERT INTO _migracoes (nome) VALUES (?)');
  const aplicadasAgora = [];

  for (const arquivo of arquivos) {
    if (jaAplicadas.has(arquivo)) continue;

    const sql = fs.readFileSync(path.join(pasta, arquivo), 'utf8');
    const aplicar = db.transaction(() => {
      db.exec(sql);
      registrar.run(arquivo);
    });

    aplicar();
    aplicadasAgora.push(arquivo);
  }

  return aplicadasAgora;
}

module.exports = { migrar };

// Rodando direto (npm run migrar): aplica no banco padrão.
if (require.main === module) {
  const { abrirBanco, CAMINHO_PADRAO } = require('./db');
  const db = abrirBanco();
  const aplicadas = migrar(db);

  if (aplicadas.length > 0) {
    console.log(`Migrações aplicadas: ${aplicadas.join(', ')}`);
  } else {
    console.log('Banco já está atualizado.');
  }
  console.log(`Banco: ${CAMINHO_PADRAO}`);
  db.close();
}
