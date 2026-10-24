import { useEffect, useState } from 'react'
import { api } from '../lib.js'
import { PageHeading } from '../components.jsx'
import './backup.css'

function formatarTamanho(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

export default function Backup() {
  const [status, setStatus] = useState(null)
  const [volumeSelecionado, setVolumeSelecionado] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  async function carregar() {
    setCarregando(true)
    setErro('')
    try {
      const dados = await api('/backups')
      setStatus(dados)
      setVolumeSelecionado(dados.volume_configurado || '')
    } catch (requestError) {
      setErro(requestError.message)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    let ativo = true
    api('/backups')
      .then((dados) => {
        if (ativo) {
          setStatus(dados)
          setVolumeSelecionado(dados.volume_configurado || '')
        }
      })
      .catch((requestError) => {
        if (ativo) setErro(requestError.message)
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => { ativo = false }
  }, [])

  async function salvarDestino() {
    setOcupado(true)
    setErro('')
    setAviso('')
    try {
      const dados = await api('/backups/destino', {
        method: 'PUT',
        body: JSON.stringify({ volume: volumeSelecionado }),
      })
      setStatus(dados)
      setAviso('Destino de backup salvo.')
    } catch (requestError) {
      setErro(requestError.message)
    } finally {
      setOcupado(false)
    }
  }

  async function criarBackup() {
    setOcupado(true)
    setErro('')
    setAviso('')
    try {
      const dados = await api('/backups', { method: 'POST' })
      setAviso(`Backup criado: ${dados.arquivo}`)
      await carregar()
    } catch (requestError) {
      setErro(requestError.message)
    } finally {
      setOcupado(false)
    }
  }

  const volumeAtual = status?.volumes.find((volume) => volume.id === status.volume_configurado)

  return (
    <div className="page-wrap">
      <PageHeading
        eyebrow="PROTEÇÃO DOS DADOS"
        title="Backup"
        description="Guarde uma cópia do banco em um dispositivo separado."
        action={<button className="button button-secondary" onClick={() => void carregar()} disabled={carregando || ocupado}>Atualizar lista</button>}
      />

      {erro && <p className="backup-alerta erro" role="alert">{erro}</p>}
      {aviso && <p className="backup-alerta sucesso" role="status">{aviso}</p>}

      <section className="panel backup-painel">
        <div>
          <div className="eyebrow">DESTINO</div>
          <h2>Dispositivo de backup</h2>
          <p>Selecione um pendrive ou disco externo conectado. Os backups ficam na pasta <strong>PDV-Backups</strong>.</p>
        </div>

        <div className="backup-controles">
          <label htmlFor="backup-volume">Dispositivo disponível</label>
          <select id="backup-volume" value={volumeSelecionado} onChange={(evento) => setVolumeSelecionado(evento.target.value)} disabled={carregando || ocupado}>
            <option value="">Selecione um dispositivo</option>
            {status?.volumes.map((volume) => (
              <option key={volume.id} value={volume.id}>{volume.nome}</option>
            ))}
          </select>
          <button className="button button-primary" onClick={() => void salvarDestino()} disabled={!volumeSelecionado || ocupado}>
            Salvar destino
          </button>
        </div>

        <div className={`backup-status ${status?.conectado ? 'conectado' : 'desconectado'}`} role="status">
          <span className="status-dot" />
          {status?.conectado
            ? `Conectado: ${volumeAtual?.nome || 'dispositivo configurado'}`
            : status?.volume_configurado
              ? 'Dispositivo de backup desconectado'
              : 'Nenhum destino de backup configurado'}
        </div>

        <div className="backup-rodape">
          <p>O sistema cria um backup diário quando o dispositivo está conectado e mantém até 30 cópias recentes. A cópia é verificada antes de ser guardada.</p>
          <button className="button button-primary" onClick={() => void criarBackup()} disabled={!status?.conectado || ocupado || carregando}>
            {ocupado ? 'Aguarde…' : 'Criar backup agora'}
          </button>
        </div>
      </section>

      {status?.erro_automatico && <p className="backup-alerta erro" role="alert">O backup automático mais recente falhou: {status.erro_automatico}</p>}

      <section className="panel backup-painel backup-lista">
        <div>
          <div className="eyebrow">CÓPIAS GUARDADAS</div>
          <h2>Histórico de backups</h2>
        </div>
        {status?.backups.length
          ? <div className="backup-arquivos">
            {status.backups.map((backup) => (
              <div className="backup-arquivo" key={backup.arquivo}>
                <strong>{new Date(backup.criado_em).toLocaleString('pt-BR')}</strong>
                <span>{backup.arquivo}</span>
                <small>{formatarTamanho(backup.tamanho_bytes)}</small>
              </div>
            ))}
          </div>
          : <p className="backup-vazio">{carregando ? 'Carregando…' : 'Nenhum backup encontrado neste destino.'}</p>}
      </section>
    </div>
  )
}
