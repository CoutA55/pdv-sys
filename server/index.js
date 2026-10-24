const { abrirBanco, CAMINHO_PADRAO } = require('./db');
const { migrar } = require('./migrate');
const { criarApp } = require('./app');
const { criarGerenciadorBackup } = require('./backup');

const PORTA = Number(process.env.PORT) || 3000;

const db = abrirBanco();
const gerenciadorBackup = criarGerenciadorBackup(db, `${CAMINHO_PADRAO}.backup-config.json`);

// Garante que o banco está atualizado sempre que o servidor inicia.
const aplicadas = migrar(db);
if (aplicadas.length > 0) {
  console.log(`Migrações aplicadas: ${aplicadas.join(', ')}`);
}

const app = criarApp(db, gerenciadorBackup);

// 127.0.0.1: só aceita conexões do próprio computador.
const servidor = app.listen(PORTA, '127.0.0.1', () => {
  console.log(`PDV rodando em http://127.0.0.1:${PORTA}`);
});

const verificacaoInicial = setTimeout(() => {
  void gerenciadorBackup.verificarBackupDiario();
}, 5000);
const verificacaoDiaria = setInterval(() => {
  void gerenciadorBackup.verificarBackupDiario();
}, 15 * 60 * 1000);

// Fecha o banco direito quando o servidor é encerrado (Ctrl+C).
function encerrar() {
  clearTimeout(verificacaoInicial);
  clearInterval(verificacaoDiaria);
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
