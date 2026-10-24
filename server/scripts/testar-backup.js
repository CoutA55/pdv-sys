const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { criarCopiaVerificada } = require('../backup');

async function main() {
  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-backup-test-'));
  const origem = new Database(path.join(diretorio, 'origem.db'));
  origem.exec('CREATE TABLE teste (valor TEXT); INSERT INTO teste VALUES (\'backup íntegro\')');

  try {
    const resultado = await criarCopiaVerificada(origem, diretorio, 'pdv-teste.db');
    assert.equal(resultado.arquivo, 'pdv-teste.db');
    assert.ok(resultado.tamanho_bytes > 0);

    const copia = new Database(path.join(diretorio, resultado.arquivo), { readonly: true });
    try {
      assert.equal(copia.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(copia.prepare('SELECT valor FROM teste').get().valor, 'backup íntegro');
    } finally {
      copia.close();
    }

    console.log('OK  cria e valida uma cópia íntegra do banco SQLite');
  } finally {
    origem.close();
    fs.rmSync(diretorio, { recursive: true, force: true });
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
