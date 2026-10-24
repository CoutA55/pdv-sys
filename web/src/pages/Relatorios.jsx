import { useEffect, useMemo, useState } from 'react'
import { api, currency, dataBr, dataIso, decimalToCents, qtyLabel, toMilesimos } from '../lib.js'
import { Metric, PageHeading } from '../components.jsx'
import './relatorios.css'

const PERIODOS = [
  { id: 'hoje', nome: 'Hoje' },
  { id: '7d', nome: 'Últimos 7 dias' },
  { id: 'mes', nome: 'Este mês' },
  { id: 'mes-passado', nome: 'Mês passado' },
  { id: 'ano', nome: 'Este ano' },
  { id: 'personalizado', nome: 'Outro período' },
]

const NOMES_FORMA = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  CARTAO_DEBITO: 'Cartão de débito',
  CARTAO_CREDITO: 'Cartão de crédito',
  FIADO: 'Fiado',
}

function intervalo(periodo) {
  const hoje = new Date()
  const ano = hoje.getFullYear()
  const mes = hoje.getMonth()
  if (periodo === 'hoje') return [hoje, hoje]
  if (periodo === '7d') return [new Date(ano, mes, hoje.getDate() - 6), hoje]
  if (periodo === 'mes') return [new Date(ano, mes, 1), hoje]
  if (periodo === 'mes-passado') return [new Date(ano, mes - 1, 1), new Date(ano, mes, 0)]
  return [new Date(ano, 0, 1), hoje]
}

export default function Relatorios({ fiado, caixaAberto, onRefresh }) {
  const [aba, setAba] = useState('faturamento')

  return (
    <div className="page-wrap">
      <PageHeading
        eyebrow="RELATÓRIOS"
        title="Relatórios"
        description="Acompanhe o faturamento, as vendas e os valores a receber."
      />
      <div className="rel-abas" role="tablist">
        <button role="tab" aria-selected={aba === 'faturamento'} className={aba === 'faturamento' ? 'ativa' : ''} onClick={() => setAba('faturamento')}>Faturamento</button>
        <button role="tab" aria-selected={aba === 'vendas'} className={aba === 'vendas' ? 'ativa' : ''} onClick={() => setAba('vendas')}>Vendas</button>
        <button role="tab" aria-selected={aba === 'fiado'} className={aba === 'fiado' ? 'ativa' : ''} onClick={() => setAba('fiado')}>Fiado</button>
      </div>
      {aba === 'faturamento'
        ? <Faturamento />
        : aba === 'vendas'
          ? <HistoricoVendas caixaAberto={caixaAberto} onRefresh={onRefresh} />
          : <Fiado report={fiado} caixaAberto={caixaAberto} onRefresh={onRefresh} />}
    </div>
  )
}

// ---------------------------------------------------------------
// Faturamento
// ---------------------------------------------------------------
function Faturamento() {
  const [periodo, setPeriodo] = useState('mes')
  const [personalizado, setPersonalizado] = useState(() => {
    const [de, ate] = intervalo('mes')
    return { de: dataIso(de), ate: dataIso(ate) }
  })
  const [agrupar, setAgrupar] = useState('auto')
  const [dados, setDados] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const [de, ate] = useMemo(() => {
    if (periodo === 'personalizado') return [personalizado.de, personalizado.ate]
    return intervalo(periodo).map(dataIso)
  }, [periodo, personalizado])

  useEffect(() => {
    if (!de || !ate || de > ate) return undefined
    let cancelado = false
    const parametros = `de=${de}&ate=${ate}${agrupar === 'auto' ? '' : `&agrupar=${agrupar}`}`
    const espera = window.setTimeout(async () => {
      setCarregando(true)
      setErro('')
      try {
        const resposta = await api(`/relatorios/faturamento?${parametros}`)
        if (!cancelado) setDados(resposta)
      } catch (requestError) {
        if (!cancelado) setErro(requestError.message)
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }, 0)
    return () => {
      cancelado = true
      window.clearTimeout(espera)
    }
  }, [de, ate, agrupar])

  const periodoInvalido = periodo === 'personalizado' && (!de || !ate || de > ate)
  const resumo = dados?.resumo
  const totalFormas = dados ? dados.por_forma.reduce((soma, forma) => soma + forma.valor_centavos, 0) : 0

  return (
    <div className={`rel-conteudo ${carregando ? 'carregando' : ''}`}>
      <div className="rel-filtros">
        <div className="rel-chips" role="group" aria-label="Período">
          {PERIODOS.map((item) => (
            <button key={item.id} className={periodo === item.id ? 'ativa' : ''} aria-pressed={periodo === item.id} onClick={() => setPeriodo(item.id)}>
              {item.nome}
            </button>
          ))}
        </div>
        {periodo === 'personalizado' && (
          <div className="rel-datas">
            <label>De<input type="date" value={personalizado.de} max={personalizado.ate} onChange={(evento) => setPersonalizado({ ...personalizado, de: evento.target.value })} /></label>
            <label>Até<input type="date" value={personalizado.ate} min={personalizado.de} onChange={(evento) => setPersonalizado({ ...personalizado, ate: evento.target.value })} /></label>
          </div>
        )}
      </div>

      {periodoInvalido && <p className="rel-aviso">Escolha uma data inicial que não seja depois da data final.</p>}
      {erro && <p className="rel-aviso erro" role="alert">{erro}</p>}

      {resumo && !periodoInvalido && (
        <>
          <p className="rel-periodo">
            {dados.periodo.de === dados.periodo.ate
              ? dataBr(dados.periodo.de)
              : `${dataBr(dados.periodo.de)} a ${dataBr(dados.periodo.ate)}`}
            {' · '}{dados.periodo.dias} {dados.periodo.dias === 1 ? 'dia' : 'dias'}
          </p>

          <div className="rel-kpis">
            <section className="rel-kpi destaque">
              <span>Faturamento</span>
              <strong>{currency(resumo.faturamento_centavos)}</strong>
              <Variacao atual={resumo.faturamento_centavos} anterior={dados.anterior.faturamento_centavos} />
            </section>
            <section className="rel-kpi">
              <span>Vendas</span>
              <strong>{resumo.vendas}</strong>
              <small>{dados.anterior.vendas} no período anterior</small>
            </section>
            <section className="rel-kpi">
              <span>Ticket médio</span>
              <strong>{currency(resumo.ticket_medio_centavos)}</strong>
              <small>Valor médio de cada venda</small>
            </section>
            <section className="rel-kpi">
              <span>Cancelamentos</span>
              <strong>{resumo.canceladas}</strong>
              <small>{resumo.canceladas ? `${currency(resumo.canceladas_centavos)} em vendas canceladas` : 'Nenhuma venda cancelada'}</small>
            </section>
          </div>

          <section className="rel-painel">
            <div className="rel-painel-topo">
              <h2>Faturamento por {dados.periodo.agrupar === 'mes' ? 'mês' : 'dia'}</h2>
              <div className="rel-acoes">
                <div className="rel-chips pequeno" role="group" aria-label="Agrupar por">
                  <button className={dados.periodo.agrupar === 'dia' ? 'ativa' : ''} onClick={() => setAgrupar('dia')}>Dia</button>
                  <button className={dados.periodo.agrupar === 'mes' ? 'ativa' : ''} onClick={() => setAgrupar('mes')}>Mês</button>
                </div>
                <button className="rel-botao" onClick={() => baixarCsv(dados.serie, dados.periodo)}>Baixar planilha (CSV)</button>
              </div>
            </div>
            {resumo.vendas === 0
              ? <p className="rel-vazio">Nenhuma venda neste período.</p>
              : <GraficoBarras serie={dados.serie} agrupar={dados.periodo.agrupar} />}
            <details className="rel-detalhes">
              <summary>Ver tabela</summary>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{dados.periodo.agrupar === 'mes' ? 'MÊS' : 'DIA'}</th><th>VENDAS</th><th>FATURAMENTO</th><th>TICKET MÉDIO</th></tr></thead>
                  <tbody>
                    {dados.serie.map((linha) => (
                      <tr key={linha.periodo}>
                        <td>{rotuloCompleto(linha.periodo, dados.periodo.agrupar)}</td>
                        <td>{linha.vendas}</td>
                        <td><strong>{currency(linha.faturamento_centavos)}</strong></td>
                        <td className="muted-cell">{linha.vendas ? currency(Math.round(linha.faturamento_centavos / linha.vendas)) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          <div className="rel-duas-colunas">
            <section className="rel-painel">
              <h2>Como os clientes pagaram</h2>
              {dados.por_forma.length === 0 ? <p className="rel-vazio">Sem pagamentos no período.</p> : (
                <ul className="rel-formas">
                  {dados.por_forma.map((forma) => {
                    const percentual = totalFormas ? (forma.valor_centavos / totalFormas) * 100 : 0
                    return (
                      <li key={forma.forma}>
                        <div className="rel-forma-texto">
                          <span>{NOMES_FORMA[forma.forma] || forma.forma}</span>
                          <strong>{currency(forma.valor_centavos)}</strong>
                          <small>{percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</small>
                        </div>
                        <div className="rel-barra"><span style={{ width: `${percentual}%` }} /></div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className="rel-painel">
              <h2>Produtos que mais faturaram</h2>
              {dados.top_produtos.length === 0 ? <p className="rel-vazio">Sem vendas no período.</p> : (
                <ol className="rel-top">
                  {dados.top_produtos.map((produto) => (
                    <li key={produto.produto_id}>
                      <span className="nome">{produto.nome}</span>
                      <span className="qtd">{qtyLabel(produto.quantidade_milesimos, produto.unidade)}</span>
                      <strong>{currency(produto.total_centavos)}</strong>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function Variacao({ atual, anterior }) {
  if (!anterior) return <small>Sem vendas no período anterior para comparar</small>
  const percentual = ((atual - anterior) / anterior) * 100
  const subiu = percentual >= 0
  return (
    <small className={`rel-variacao ${subiu ? 'sobe' : 'desce'}`}>
      {subiu ? '▲' : '▼'} {Math.abs(percentual).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% sobre o período anterior ({currency(anterior)})
    </small>
  )
}

// "2026-10-05" -> "05"; "2026-10" -> "out"
function rotuloCurto(periodo, agrupar) {
  if (agrupar === 'dia') return periodo.slice(8, 10)
  const [ano, mes] = periodo.split('-').map(Number)
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
}

function rotuloCompleto(periodo, agrupar) {
  if (agrupar === 'dia') {
    const [ano, mes, dia] = periodo.split('-').map(Number)
    const data = new Date(ano, mes - 1, dia)
    return `${dataBr(periodo)} · ${data.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}`
  }
  const [ano, mes] = periodo.split('-').map(Number)
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

const abreviar = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })

function GraficoBarras({ serie, agrupar }) {
  const largura = 820
  const altura = 280
  const margem = { topo: 16, base: 30, esquerda: 56, direita: 8 }
  const areaLargura = largura - margem.esquerda - margem.direita
  const areaAltura = altura - margem.topo - margem.base
  const maximo = Math.max(...serie.map((item) => item.faturamento_centavos), 1)
  const passo = areaLargura / serie.length
  const larguraBarra = Math.max(Math.min(passo * 0.66, 46), 3)
  const pulo = Math.ceil(serie.length / 14)
  const indiceMaior = serie.findIndex((item) => item.faturamento_centavos === maximo)

  return (
    <svg className="rel-grafico" viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label="Gráfico de barras do faturamento no período">
      {[0, 0.5, 1].map((fracao) => {
        const y = margem.topo + areaAltura * (1 - fracao)
        return (
          <g key={fracao}>
            <line x1={margem.esquerda} x2={largura - margem.direita} y1={y} y2={y} className="grade" />
            <text x={margem.esquerda - 8} y={y + 4} textAnchor="end" className="eixo">{abreviar.format((maximo * fracao) / 100)}</text>
          </g>
        )
      })}
      {serie.map((item, indice) => {
        const alturaBarra = (item.faturamento_centavos / maximo) * areaAltura
        const x = margem.esquerda + passo * indice + (passo - larguraBarra) / 2
        return (
          <g key={item.periodo}>
            <rect
              x={x}
              y={margem.topo + areaAltura - alturaBarra}
              width={larguraBarra}
              height={Math.max(alturaBarra, item.faturamento_centavos > 0 ? 2 : 0)}
              rx="3"
              className={indice === indiceMaior ? 'barra maior' : 'barra'}
            >
              <title>{`${rotuloCompleto(item.periodo, agrupar)}: ${currency(item.faturamento_centavos)} em ${item.vendas} ${item.vendas === 1 ? 'venda' : 'vendas'}`}</title>
            </rect>
            {indice % pulo === 0 && (
              <text x={x + larguraBarra / 2} y={altura - 8} textAnchor="middle" className="eixo">{rotuloCurto(item.periodo, agrupar)}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// Planilha com ponto e vírgula e acentos corretos para abrir direto no Excel brasileiro.
function baixarCsv(serie, periodo) {
  const linhas = [
    ['Período', 'Vendas', 'Faturamento (R$)'],
    ...serie.map((item) => [
      periodo.agrupar === 'dia' ? dataBr(item.periodo) : item.periodo.split('-').reverse().join('/'),
      item.vendas,
      (item.faturamento_centavos / 100).toFixed(2).replace('.', ','),
    ]),
  ]
  const texto = `\uFEFF${linhas.map((linha) => linha.join(';')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `faturamento-${periodo.de}-a-${periodo.ate}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function HistoricoVendas({ caixaAberto, onRefresh }) {
  const [periodoInicial] = useState(() => {
    const hoje = new Date()
    const inicio = new Date(hoje)
    inicio.setDate(inicio.getDate() - 29)
    return { de: dataIso(inicio), ate: dataIso(hoje) }
  })
  const [de, setDe] = useState(periodoInicial.de)
  const [ate, setAte] = useState(periodoInicial.ate)
  const [vendas, setVendas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [recarga, setRecarga] = useState(0)
  const [vendaCancelar, setVendaCancelar] = useState(null)
  const [itemDevolver, setItemDevolver] = useState(null)
  const [quantidadeDevolver, setQuantidadeDevolver] = useState('')
  const [destinoDevolver, setDestinoDevolver] = useState('ESTOQUE')
  const [motivoDevolver, setMotivoDevolver] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!de || !ate || de > ate) return undefined
    let cancelado = false
    const espera = window.setTimeout(async () => {
      setCarregando(true)
      setErro('')
      try {
        const resultado = await api(`/vendas/historico?de=${de}&ate=${ate}&limite=200`)
        if (!cancelado) setVendas(resultado.vendas)
      } catch (requestError) {
        if (!cancelado) setErro(requestError.message)
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }, 0)
    return () => {
      cancelado = true
      window.clearTimeout(espera)
    }
  }, [de, ate, recarga])

  async function cancelarVenda(evento) {
    evento.preventDefault()
    if (!motivo.trim()) {
      setErro('Informe por que a venda está sendo cancelada.')
      return
    }
    setSalvando(true)
    setErro('')
    try {
      await api(`/vendas/${encodeURIComponent(vendaCancelar.id)}/cancelar`, {
        method: 'POST',
        body: JSON.stringify({ motivo }),
      })
      setVendaCancelar(null)
      setMotivo('')
      setRecarga((atual) => atual + 1)
      await onRefresh()
    } catch (requestError) {
      setErro(requestError.message)
    } finally {
      setSalvando(false)
    }
  }

  function iniciarDevolucao(venda, item) {
    setItemDevolver({ venda, item })
    setQuantidadeDevolver(String(item.quantidade_disponivel_milesimos / 1000).replace('.', ','))
    setDestinoDevolver('ESTOQUE')
    setMotivoDevolver('')
    setErro('')
    setSucesso('')
  }

  async function devolverItem(evento) {
    evento.preventDefault()
    const quantidade = toMilesimos(quantidadeDevolver)
    if (!Number.isSafeInteger(quantidade) || quantidade <= 0) {
      setErro('Informe uma quantidade válida para devolver.')
      return
    }
    if (quantidade > itemDevolver.item.quantidade_disponivel_milesimos) {
      setErro('A quantidade supera o que ainda pode ser devolvido.')
      return
    }
    if (!motivoDevolver.trim()) {
      setErro('Informe o motivo da devolução.')
      return
    }

    setSalvando(true)
    setErro('')
    try {
      const resultado = await api(`/vendas/${encodeURIComponent(itemDevolver.venda.id)}/devolver-item`, {
        method: 'POST',
        body: JSON.stringify({
          venda_item_id: itemDevolver.item.id,
          quantidade_milesimos: quantidade,
          destino: destinoDevolver,
          motivo: motivoDevolver,
        }),
      })
      setItemDevolver(null)
      setSucesso(`Devolução registrada: ${currency(resultado.valor_devolvido_centavos)}.`)
      setRecarga((atual) => atual + 1)
      await onRefresh()
    } catch (requestError) {
      setErro(requestError.message)
    } finally {
      setSalvando(false)
    }
  }

  const periodoInvalido = !de || !ate || de > ate

  return (
    <div className={`rel-conteudo ${carregando ? 'carregando' : ''}`}>
      <section className="rel-painel">
        <div className="rel-painel-topo">
          <div><div className="eyebrow">CONSULTA DE VENDAS</div><h2>Histórico</h2></div>
          <span className="result-count">{vendas.length} vendas</span>
        </div>
        <div className="rel-filtros">
          <div className="rel-datas">
            <label>De<input type="date" value={de} max={ate} onChange={(evento) => setDe(evento.target.value)} /></label>
            <label>Até<input type="date" value={ate} min={de} onChange={(evento) => setAte(evento.target.value)} /></label>
          </div>
        </div>
        {!caixaAberto && <p className="rel-aviso">Abra o caixa para cancelar uma venda. A consulta do histórico continua disponível.</p>}
        {periodoInvalido && <p className="rel-aviso">Escolha um período válido.</p>}
        {erro && <p className="rel-aviso erro" role="alert">{erro}</p>}
        {sucesso && <p className="rel-aviso rel-sucesso" role="status">{sucesso}</p>}
        {!periodoInvalido && !carregando && !erro && vendas.length === 0 && <p className="rel-vazio">Nenhuma venda encontrada neste período.</p>}
        {vendas.length > 0 && (
          <div className="rel-vendas-lista">
            {vendas.map((venda) => (
              <article className={`rel-venda ${venda.status === 'CANCELADA' ? 'cancelada' : ''}`} key={venda.id}>
                <div className="rel-venda-topo">
                  <div>
                    <strong>{dataBr(dataIso(new Date(venda.criado_em)))} · {new Date(venda.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                    <small>Venda {venda.id.slice(0, 8)} · Operador: {venda.operador_nome}{venda.cliente_nome ? ` · Cliente: ${venda.cliente_nome}` : ''}</small>
                  </div>
                  <div className="rel-venda-valor">
                    <strong>{currency(venda.total_centavos)}</strong>
                    <span className={`rel-venda-status ${venda.status === 'CANCELADA' ? 'cancelada' : ''}`}>{venda.status === 'CANCELADA' ? 'Cancelada' : 'Concluída'}</span>
                  </div>
                </div>
                <details>
                  <summary>Ver itens e pagamentos</summary>
                  <ul className="rel-venda-itens">
                    {venda.itens.map((item, indice) => (
                      <li key={`${venda.id}-${indice}`}>
                        <span>
                          {item.descricao} × {qtyLabel(item.quantidade_milesimos, item.unidade)}
                          {item.quantidade_devolvida_milesimos > 0 && (
                            <small className="rel-item-devolvido">
                              Devolvido: {qtyLabel(item.quantidade_devolvida_milesimos, item.unidade)} · Restante: {qtyLabel(item.quantidade_disponivel_milesimos, item.unidade)}
                            </small>
                          )}
                          {venda.status === 'CONCLUIDA' && (venda.desconto_centavos > 0 || item.desconto_centavos > 0) && (
                            <small className="rel-item-devolvido">Devolução parcial indisponível em venda com desconto.</small>
                          )}
                        </span>
                        <strong>{currency(item.total_centavos)}</strong>
                        {venda.status === 'CONCLUIDA' && item.quantidade_disponivel_milesimos > 0 && (
                          <button
                            type="button"
                            className="rel-botao"
                            disabled={!caixaAberto || venda.desconto_centavos > 0 || item.desconto_centavos > 0}
                            onClick={() => iniciarDevolucao(venda, item)}
                          >
                            Devolver item
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <ul className="rel-venda-pagamentos">
                    {venda.pagamentos.map((pagamento) => (
                      <li key={pagamento.id}>
                        <span>
                          {NOMES_FORMA[pagamento.forma] || pagamento.forma}
                          {pagamento.valor_devolvido_centavos > 0 && ` · devolvido ${currency(pagamento.valor_devolvido_centavos)}`}
                        </span>
                        <strong>{currency(pagamento.valor_centavos)}</strong>
                      </li>
                    ))}
                  </ul>
                  {venda.devolucoes?.length > 0 && (
                    <div className="rel-devolucoes">
                      <strong>Devoluções registradas</strong>
                      {venda.devolucoes.map((devolucao) => (
                        <p key={devolucao.id}>
                          {devolucao.descricao
                            ? `${devolucao.descricao} · ${qtyLabel(devolucao.quantidade_milesimos, devolucao.unidade || 'UN')}`
                            : 'Devolução em dinheiro de fiado já pago'}
                          {' · '}
                          {devolucao.destino === 'ESTOQUE' ? 'voltou ao estoque' : devolucao.destino === 'DESCARTE' ? 'descartado' : ''}
                          {' · '}{currency(devolucao.valor_centavos ?? 0)} · {devolucao.motivo}
                        </p>
                      ))}
                    </div>
                  )}
                  {venda.status === 'CANCELADA' && (
                    <p className="rel-venda-motivo">Cancelada por {venda.cancelada_por_nome || 'operador'}: {venda.motivo_cancelamento}</p>
                  )}
                </details>
                {venda.status === 'CONCLUIDA' && (
                  <div className="rel-venda-acoes">
                    <button type="button" className="rel-botao rel-botao-perigo" disabled={!caixaAberto} onClick={() => { setVendaCancelar(venda); setMotivo(''); setErro('') }}>
                      Cancelar venda
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {vendaCancelar && (
        <div className="rel-receber-fundo" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget && !salvando) setVendaCancelar(null) }}>
          <section className="rel-receber-modal" role="dialog" aria-modal="true" aria-labelledby="rel-cancelar-titulo">
            <div className="rel-receber-topo">
              <div><div className="eyebrow">CORREÇÃO DE VENDA</div><h2 id="rel-cancelar-titulo">Cancelar venda</h2></div>
              <button type="button" className="icon-button" disabled={salvando} onClick={() => setVendaCancelar(null)} aria-label="Fechar">×</button>
            </div>
            <p>Venda de <strong>{currency(vendaCancelar.total_centavos)}</strong>. Esta ação não pode ser desfeita.</p>
            <p className="rel-aviso">
              Itens que ainda não foram devolvidos retornarão ao estoque. O saldo em fiado será abatido; se a conta já tiver sido quitada, o valor correspondente será devolvido em dinheiro.
            </p>
            <ul className="rel-venda-pagamentos">
              {vendaCancelar.pagamentos.map((pagamento) => (
                <li key={pagamento.id}>
                  <span>{pagamento.forma === 'FIADO' ? 'Fiado (estorno na conta)' : NOMES_FORMA[pagamento.forma] || pagamento.forma}</span>
                  <strong>{currency(Math.max(pagamento.valor_centavos - pagamento.valor_devolvido_centavos, 0))} restante</strong>
                </li>
              ))}
            </ul>
            <form onSubmit={cancelarVenda}>
              <label>Motivo do cancelamento
                <input autoFocus value={motivo} onChange={(evento) => setMotivo(evento.target.value)} maxLength={500} placeholder="Ex.: produto lançado por engano" required />
              </label>
              {erro && <p className="rel-aviso erro" role="alert">{erro}</p>}
              <div className="rel-receber-acoes">
                <button type="button" className="rel-botao" disabled={salvando} onClick={() => setVendaCancelar(null)}>Voltar</button>
                <button type="submit" className="rel-botao rel-botao-perigo" disabled={salvando || !caixaAberto}>{salvando ? 'Cancelando...' : 'Confirmar cancelamento'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {itemDevolver && (
        <div className="rel-receber-fundo" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget && !salvando) setItemDevolver(null) }}>
          <section className="rel-receber-modal" role="dialog" aria-modal="true" aria-labelledby="rel-devolver-titulo">
            <div className="rel-receber-topo">
              <div><div className="eyebrow">DEVOLUÇÃO DE ITEM</div><h2 id="rel-devolver-titulo">Devolver produto</h2></div>
              <button type="button" className="icon-button" disabled={salvando} onClick={() => setItemDevolver(null)} aria-label="Fechar">×</button>
            </div>
            <p><strong>{itemDevolver.item.descricao}</strong> · ainda disponível: {qtyLabel(itemDevolver.item.quantidade_disponivel_milesimos, itemDevolver.item.unidade)}.</p>
            {(itemDevolver.venda.desconto_centavos > 0 || itemDevolver.item.desconto_centavos > 0) && (
              <p className="rel-aviso">Devolução parcial de vendas com desconto ainda não está disponível.</p>
            )}
            <p className="rel-aviso">
              O valor será devolvido proporcionalmente às formas de pagamento originais. Se o fiado já tiver sido quitado, a parte correspondente será devolvida em dinheiro.
            </p>
            <form onSubmit={devolverItem}>
              <label>Quantidade
                <input
                  autoFocus
                  inputMode="decimal"
                  step={itemDevolver.item.unidade === 'UN' ? '1' : '0.001'}
                  value={quantidadeDevolver}
                  onChange={(evento) => setQuantidadeDevolver(evento.target.value)}
                  required
                />
              </label>
              <fieldset className="rel-destino-devolucao">
                <legend>Destino do produto</legend>
                <label><input type="radio" name="destino-devolucao" value="ESTOQUE" checked={destinoDevolver === 'ESTOQUE'} onChange={() => setDestinoDevolver('ESTOQUE')} /> Voltar ao estoque vendável</label>
                <label><input type="radio" name="destino-devolucao" value="DESCARTE" checked={destinoDevolver === 'DESCARTE'} onChange={() => setDestinoDevolver('DESCARTE')} /> Descartar (vencido ou avariado)</label>
              </fieldset>
              <label>Motivo
                <input value={motivoDevolver} onChange={(evento) => setMotivoDevolver(evento.target.value)} maxLength={500} placeholder="Ex.: produto vencido" required />
              </label>
              {erro && <p className="rel-aviso erro" role="alert">{erro}</p>}
              <div className="rel-receber-acoes">
                <button type="button" className="rel-botao" disabled={salvando} onClick={() => setItemDevolver(null)}>Voltar</button>
                <button type="submit" className="button button-primary" disabled={salvando || !caixaAberto || itemDevolver.venda.desconto_centavos > 0 || itemDevolver.item.desconto_centavos > 0}>
                  {salvando ? 'Registrando...' : 'Confirmar devolução'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// Fiado (o relatório que já existia)
// ---------------------------------------------------------------
function Fiado({ report, caixaAberto, onRefresh }) {
  const [clienteSelecionado, setClienteSelecionado] = useState(null)
  const [clienteExtrato, setClienteExtrato] = useState(null)
  const [clientesParaConsulta, setClientesParaConsulta] = useState([])
  const [clienteConsultaId, setClienteConsultaId] = useState('')
  const [erroClientes, setErroClientes] = useState('')
  const [valor, setValor] = useState('')
  const [forma, setForma] = useState('DINHEIRO')
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let cancelado = false
    async function carregarClientes() {
      setErroClientes('')
      try {
        const resultado = await api('/clientes/todos')
        if (!cancelado) setClientesParaConsulta(resultado)
      } catch (requestError) {
        if (!cancelado) setErroClientes(requestError.message)
      }
    }
    carregarClientes()
    return () => { cancelado = true }
  }, [report])

  function iniciarRecebimento(cliente) {
    setClienteSelecionado(cliente)
    setValor(String(cliente.saldo_devedor_centavos / 100).replace('.', ','))
    setForma('DINHEIRO')
    setObservacao('')
    setErro('')
  }

  async function registrarRecebimento(evento) {
    evento.preventDefault()
    const valorCentavos = decimalToCents(valor)
    if (!Number.isSafeInteger(valorCentavos) || valorCentavos <= 0) {
      setErro('Informe um valor maior que zero.')
      return
    }
    if (valorCentavos > clienteSelecionado.saldo_devedor_centavos) {
      setErro('O valor não pode ser maior que a dívida atual.')
      return
    }

    setSalvando(true)
    setErro('')
    try {
      await api('/relatorios/fiado/pagamentos', {
        method: 'POST',
        body: JSON.stringify({
          cliente_id: clienteSelecionado.id,
          valor_centavos: valorCentavos,
          forma_pagamento: forma,
          observacao,
        }),
      })
      setClienteSelecionado(null)
      await onRefresh()
    } catch (requestError) {
      setErro(requestError.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="rel-conteudo">
      <div className="metric-grid report-metrics">
        <Metric icon="$" tone="purple" label="TOTAL A RECEBER" value={currency(report?.resumo.total_a_receber_centavos)} helper="Saldo atual em aberto" />
        <Metric icon="◎" tone="blue" label="CLIENTES DEVEDORES" value={report?.resumo.clientes_devedores ?? 0} helper="Com saldo acima de zero" />
        <Metric icon="↗" tone="green" label="VENDAS NO FIADO" value={currency(report?.resumo.total_vendas_fiadas_centavos)} helper={`${report?.resumo.quantidade_vendas_fiadas ?? 0} vendas concluídas`} />
      </div>
      <section className="panel report-panel">
        <div className="section-title">
          <div><div className="eyebrow">CONTAS A RECEBER</div><h2>Quem está devendo</h2></div>
          <span className="result-count">{report?.clientes.length ?? 0} clientes</span>
        </div>
        {!caixaAberto && <p className="rel-aviso">Abra o caixa para registrar recebimentos do fiado.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>CLIENTE</th><th>TELEFONE</th><th>SALDO DEVEDOR</th><th>AÇÕES</th></tr></thead>
            <tbody>
              {report?.clientes.map((client) => (
                <tr key={client.id}>
                  <td><div className="table-product"><div className="product-avatar client-avatar">{client.nome.slice(0, 1).toUpperCase()}</div><div><strong>{client.nome}</strong><small>Cliente com conta em aberto</small></div></div></td>
                  <td className="muted-cell">{client.telefone || '—'}</td>
                  <td><strong className="debt-value">{currency(client.saldo_devedor_centavos)}</strong></td>
                  <td>
                    <div className="rel-cliente-acoes">
                      <button type="button" className="rel-botao" onClick={() => setClienteExtrato(client)}>Ver extrato</button>
                      <button type="button" className="rel-botao" disabled={!caixaAberto} onClick={() => iniciarRecebimento(client)}>Registrar pagamento</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!report?.clientes.length && <tr><td colSpan="4"><div className="empty-state compact-empty"><span className="empty-icon">✓</span><strong>Nenhuma conta em aberto</strong><small>Quando houver vendas fiadas, elas aparecem aqui.</small></div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rel-painel">
        <div className="rel-painel-topo">
          <div><div className="eyebrow">HISTÓRICO DO CLIENTE</div><h2>Consultar extrato individual</h2></div>
        </div>
        <div className="rel-consulta-cliente">
          <label>Cliente
            <select value={clienteConsultaId} onChange={(evento) => setClienteConsultaId(evento.target.value)}>
              <option value="">Selecione um cliente</option>
              {clientesParaConsulta.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {cliente.nome} · saldo {currency(cliente.saldo_devedor_centavos)}{cliente.ativo ? '' : ' · inativo'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rel-botao"
            disabled={!clienteConsultaId}
            onClick={() => setClienteExtrato(clientesParaConsulta.find((cliente) => cliente.id === clienteConsultaId))}
          >
            Ver extrato
          </button>
        </div>
        {erroClientes && <p className="rel-aviso erro" role="alert">{erroClientes}</p>}
        <p className="report-note">A consulta inclui clientes sem dívida atual e contas de clientes inativos.</p>
      </section>
      <p className="report-note">“Total a receber” considera os pagamentos já feitos. “Vendas no fiado” é o total histórico das vendas fiadas concluídas.</p>

      {clienteSelecionado && (
        <div className="rel-receber-fundo" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget && !salvando) setClienteSelecionado(null) }}>
          <section className="rel-receber-modal" role="dialog" aria-modal="true" aria-labelledby="rel-receber-titulo">
            <div className="rel-receber-topo">
              <div><div className="eyebrow">CONTAS A RECEBER</div><h2 id="rel-receber-titulo">Registrar pagamento</h2></div>
              <button type="button" className="icon-button" disabled={salvando} onClick={() => setClienteSelecionado(null)} aria-label="Fechar">×</button>
            </div>
            <p><strong>{clienteSelecionado.nome}</strong> deve {currency(clienteSelecionado.saldo_devedor_centavos)}.</p>
            <form onSubmit={registrarRecebimento}>
              <label>Valor recebido (R$)
                <input autoFocus inputMode="decimal" value={valor} onChange={(evento) => setValor(evento.target.value)} required />
              </label>
              <label>Forma de pagamento
                <select value={forma} onChange={(evento) => setForma(evento.target.value)}>
                  <option value="DINHEIRO">Dinheiro</option>
                  <option value="PIX">Pix</option>
                  <option value="CARTAO_DEBITO">Cartão de débito</option>
                  <option value="CARTAO_CREDITO">Cartão de crédito</option>
                </select>
              </label>
              <label>Observação (opcional)
                <input value={observacao} onChange={(evento) => setObservacao(evento.target.value)} placeholder="Ex.: pagamento parcial" />
              </label>
              {erro && <p className="rel-aviso erro" role="alert">{erro}</p>}
              <div className="rel-receber-acoes">
                <button type="button" className="rel-botao" disabled={salvando} onClick={() => setClienteSelecionado(null)}>Cancelar</button>
                <button type="submit" className="button button-primary" disabled={salvando || !caixaAberto}>{salvando ? 'Registrando...' : 'Confirmar pagamento'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {clienteExtrato && <ExtratoFiadoModal cliente={clienteExtrato} onFechar={() => setClienteExtrato(null)} />}
    </div>
  )
}

function ExtratoFiadoModal({ cliente, onFechar }) {
  const [dados, setDados] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      try {
        const resultado = await api(`/clientes/${encodeURIComponent(cliente.id)}/extrato?limite=100`)
        if (!cancelado) setDados(resultado)
      } catch (requestError) {
        if (!cancelado) setErro(requestError.message)
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }
    carregar()
    return () => { cancelado = true }
  }, [cliente.id])

  async function carregarMais() {
    if (!dados?.proximo_deslocamento || carregandoMais) return
    setCarregandoMais(true)
    setErro('')
    try {
      const proxima = await api(
        `/clientes/${encodeURIComponent(cliente.id)}/extrato?limite=100&deslocamento=${dados.proximo_deslocamento}`
      )
      setDados((atual) => ({
        ...proxima,
        lancamentos: [...(atual?.lancamentos ?? []), ...proxima.lancamentos],
      }))
    } catch (requestError) {
      setErro(requestError.message)
    } finally {
      setCarregandoMais(false)
    }
  }

  function textoLancamento(lancamento) {
    if (lancamento.origem === 'VENDA') return `Compra fiada${lancamento.itens_venda ? ` · ${lancamento.itens_venda}` : ''}`
    if (lancamento.origem === 'PAGAMENTO') return `Pagamento${lancamento.forma_pagamento ? ` · ${NOMES_FORMA[lancamento.forma_pagamento] || lancamento.forma_pagamento}` : ''}`
    if (lancamento.origem === 'ESTORNO') return 'Estorno de venda'
    return lancamento.observacao || 'Ajuste'
  }

  return (
    <div className="rel-receber-fundo" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onFechar() }}>
      <section className="rel-receber-modal rel-extrato-modal" role="dialog" aria-modal="true" aria-labelledby="rel-extrato-titulo">
        <div className="rel-receber-topo">
          <div><div className="eyebrow">CONTA DO CLIENTE</div><h2 id="rel-extrato-titulo">Extrato do fiado</h2></div>
          <button type="button" className="icon-button" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        <div className="rel-extrato-resumo">
          <strong>{cliente.nome}</strong>
          <span>Saldo atual: <b>{currency(dados?.cliente.saldo_devedor_centavos ?? cliente.saldo_devedor_centavos)}</b></span>
        </div>
        {erro && <p className="rel-aviso erro" role="alert">{erro}</p>}
        {carregando && <p className="rel-vazio">Carregando extrato…</p>}
        {!carregando && !erro && dados?.lancamentos.length === 0 && <p className="rel-vazio">Nenhum lançamento encontrado para este cliente.</p>}
        {dados?.lancamentos.length > 0 && (
          <>
            <div className="rel-extrato-lista">
              {dados.lancamentos.map((lancamento) => {
                const debito = lancamento.tipo === 'DEBITO'
                return (
                  <article key={lancamento.id}>
                    <div>
                      <strong>{textoLancamento(lancamento)}</strong>
                      <small>{new Date(lancamento.criado_em).toLocaleString('pt-BR')}{lancamento.operador_nome ? ` · ${lancamento.operador_nome}` : ''}</small>
                      {lancamento.observacao && lancamento.origem !== 'AJUSTE' && <small>{lancamento.observacao}</small>}
                    </div>
                    <div className="rel-extrato-valores">
                      <strong className={debito ? 'debito' : 'credito'}>{debito ? '+' : '−'}{currency(lancamento.valor_centavos)}</strong>
                      <small>Saldo: {currency(lancamento.saldo_apos_centavos)}</small>
                    </div>
                  </article>
                )
              })}
            </div>
            {dados.proximo_deslocamento !== null && (
              <button type="button" className="rel-botao rel-extrato-mais" onClick={carregarMais} disabled={carregandoMais}>
                {carregandoMais ? 'Carregando…' : 'Carregar lançamentos anteriores'}
              </button>
            )}
          </>
        )}
        <p className="report-note">O saldo exibido após cada lançamento é calculado pela ordem em que os registros foram feitos.</p>
      </section>
    </div>
  )
}
