// Erro "esperado" (dados inválidos, item não encontrado...).
// O tratador de erros em app.js transforma isso em uma resposta JSON.
class ErroDeRequisicao extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

module.exports = { ErroDeRequisicao };
