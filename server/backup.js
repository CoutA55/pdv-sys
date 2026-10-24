const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');

const NOME_PASTA = 'PDV-Backups';
const LIMITE_BACKUPS = 30;

async function criarCopiaVerificada(db, diretorio, nomeArquivo, validarDestino = null) {
  validarDestino?.();
  fs.mkdirSync(diretorio, { recursive: true });
  const temporario = path.join(diretorio, `.pdv-${randomUUID()}.tmp.db`);
  const arquivo = path.join(diretorio, nomeArquivo);
  let publicado = false;

  try {
    await db.backup(temporario);
    const copia = new Database(temporario, { readonly: true, fileMustExist: true });
    try {
      const verificacao = copia.pragma('integrity_check', { simple: true });
      if (verificacao !== 'ok') throw new Error(`Falha na verificação do backup: ${verificacao}`);
    } finally {
      copia.close();
    }

    validarDestino?.();
    fs.renameSync(temporario, arquivo);
    publicado = true;
    validarDestino?.();
    return {
      arquivo: path.basename(arquivo),
      criado_em: new Date().toISOString(),
      tamanho_bytes: fs.statSync(arquivo).size,
    };
  } catch (erro) {
    for (const caminho of [temporario, ...(publicado ? [arquivo] : [])]) {
      try {
        fs.unlinkSync(caminho);
      } catch (limpezaErro) {
        if (limpezaErro.code !== 'ENOENT') throw limpezaErro;
      }
    }
    throw erro;
  }
}

function decodificarCaminhoMontagem(valor) {
  return valor.replace(/\\(040|011|012|134)/g, (codigo) => ({
    '\\040': ' ',
    '\\011': '\t',
    '\\012': '\n',
    '\\134': '\\',
  })[codigo] || codigo);
}

function listarVolumesMontados() {
  const usuario = os.userInfo().username;
  const raizesPermitidas = [
    path.join('/run/media', usuario),
    path.join('/media', usuario),
    '/mnt',
  ];
  const montagens = fs.readFileSync('/proc/self/mounts', 'utf8').split('\n');
  const volumes = new Map();

  for (const linha of montagens) {
    const partes = linha.split(' ');
    if (partes.length < 3) continue;
    const montagem = path.resolve(decodificarCaminhoMontagem(partes[1]));
    const permitida = raizesPermitidas.some((raiz) => montagem.startsWith(`${raiz}${path.sep}`));
    if (!permitida || !fs.existsSync(montagem)) continue;

    const nome = path.basename(montagem);
    volumes.set(montagem, { id: montagem, nome });
  }

  return [...volumes.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function dataLocal() {
  const agora = new Date();
  const dois = (valor) => String(valor).padStart(2, '0');
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}

function horarioLocal() {
  const agora = new Date();
  const dois = (valor) => String(valor).padStart(2, '0');
  return `${dataLocal()}-${dois(agora.getHours())}-${dois(agora.getMinutes())}-${dois(agora.getSeconds())}-${String(agora.getMilliseconds()).padStart(3, '0')}`;
}

function criarGerenciadorBackup(db, configPath) {
  let erroAutomatico = '';
  let tarefaAtiva = null;

  function lerConfiguracao() {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (erro) {
      if (erro.code === 'ENOENT') return {};
      throw erro;
    }
  }

  function gravarConfiguracao(configuracao) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const temporario = `${configPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporario, JSON.stringify(configuracao, null, 2), { mode: 0o600 });
      fs.renameSync(temporario, configPath);
    } catch (erro) {
      try {
        fs.unlinkSync(temporario);
      } catch (limpezaErro) {
        if (limpezaErro.code !== 'ENOENT') throw limpezaErro;
      }
      throw erro;
    }
  }

  function obterVolumeConfigurado() {
    const configuracao = lerConfiguracao();
    const volume = listarVolumesMontados().find((item) => item.id === configuracao.volume);
    return { configuracao, volume };
  }

  function diretorioBackups(volume) {
    return path.join(volume.id, NOME_PASTA);
  }

  function listarArquivos(diretorio) {
    if (!fs.existsSync(diretorio)) return [];
    return fs.readdirSync(diretorio)
      .filter((nome) => /^pdv-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{3}\.db$/.test(nome))
      .sort()
      .reverse();
  }

  async function criarBackup({ automatico = false } = {}) {
    if (tarefaAtiva) return tarefaAtiva;

    tarefaAtiva = (async () => {
      const { volume } = obterVolumeConfigurado();
      if (!volume) {
        const erro = new Error('O dispositivo de backup configurado não está conectado. Conecte-o e tente novamente.');
        erro.code = 'BACKUP_DESTINO_INDISPONIVEL';
        throw erro;
      }

      const destino = diretorioBackups(volume);
      const arquivo = path.join(destino, `pdv-${horarioLocal()}.db`);

      try {
        const validarDestino = () => {
          if (!listarVolumesMontados().some((item) => item.id === volume.id)) {
            throw new Error('O dispositivo foi desconectado durante o backup. Conecte-o novamente e tente outra vez.');
          }
        };
        const resultado = await criarCopiaVerificada(db, destino, path.basename(arquivo), validarDestino);
        const backups = listarArquivos(destino);
        for (const antigo of backups.slice(LIMITE_BACKUPS)) {
          fs.unlinkSync(path.join(destino, antigo));
        }

        erroAutomatico = '';
        return resultado;
      } catch (erro) {
        if (automatico) erroAutomatico = erro.message;
        throw erro;
      }
    })();

    try {
      return await tarefaAtiva;
    } finally {
      tarefaAtiva = null;
    }
  }

  function status() {
    const volumes = listarVolumesMontados();
    const { configuracao, volume } = obterVolumeConfigurado();
    const backups = volume ? listarArquivos(diretorioBackups(volume)).map((arquivo) => {
      const caminho = path.join(diretorioBackups(volume), arquivo);
      const estatisticas = fs.statSync(caminho);
      return {
        arquivo,
        criado_em: estatisticas.mtime.toISOString(),
        tamanho_bytes: estatisticas.size,
      };
    }) : [];

    return {
      volumes,
      volume_configurado: configuracao.volume || null,
      conectado: Boolean(volume),
      backups,
      erro_automatico: erroAutomatico,
    };
  }

  function configurarVolume(id) {
    const volume = listarVolumesMontados().find((item) => item.id === id);
    if (!volume) throw new Error('Esse dispositivo não está disponível. Atualize a lista e tente novamente.');
    gravarConfiguracao({ volume: volume.id });
    erroAutomatico = '';
    return status();
  }

  async function verificarBackupDiario() {
    try {
      const { volume } = obterVolumeConfigurado();
      if (!volume) return;
      const arquivos = listarArquivos(diretorioBackups(volume));
      const hoje = dataLocal();
      if (arquivos.some((arquivo) => arquivo.startsWith(`pdv-${hoje}-`))) return;
      await criarBackup({ automatico: true });
      console.info('Backup diário do PDV criado com sucesso.');
    } catch (erro) {
      erroAutomatico = erro.message;
      console.error(`Não foi possível criar o backup diário: ${erro.message}`);
    }
  }

  return { criarBackup, configurarVolume, status, verificarBackupDiario };
}

module.exports = { criarCopiaVerificada, criarGerenciadorBackup, listarVolumesMontados };
