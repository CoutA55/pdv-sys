const { abrirBanco } = require('./db');
const { migrar } = require('./migrate');
const { criarApp } = require('./app');

const PORTA = Number(process.env.PORT) || 3000;

const db = abrirBanco();

// Garante que o banco está atualizado sempre que o servidor inicia.
const aplicadas = migrar(db);
if (aplicadas.length > 0) {
  console.log(`Migrações aplicadas: ${aplicadas.join(', ')}`);
}

const app = criarApp(db);

// 127.0.0.1: só aceita conexões do próprio computador.
const servidor = app.listen(PORTA, '127.0.0.1', () => {
  console.log(`PDV rodando em http://127.0.0.1:${PORTA}`);
});

// Fecha o banco direito quando o servidor é encerrado (Ctrl+C).
function encerrar() {
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
