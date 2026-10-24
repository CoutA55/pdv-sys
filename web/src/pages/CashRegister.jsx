import { useEffect, useRef, useState } from 'react'
import { api, currency, decimalToCents, milesimosToInput, qtyLabel, toMilesimos } from '../lib.js'
import { PageHeading } from '../components.jsx'
import './caixa.css'

const FORMAS = [
  { id: 'DINHEIRO', nome: 'Dinheiro' },
  { id: 'PIX', nome: 'Pix' },
  { id: 'CARTAO_DEBITO', nome: 'Débito' },
  { id: 'CARTAO_CREDITO', nome: 'Crédito' },
  { id: 'FIADO', nome: 'Fiado' },
]

const CAMINHOS = {
  busca: 'M10 4a6 6 0 1 0 3.5 10.9l4.8 4.8 1.4-1.4-4.8-4.8A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
  pagar: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm1 2v8h16V8H4Zm8 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3h2v2h-2V7Zm0 4h2v6h-2v-6Z',
  preco: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V4h9l8.6 6.6a2 2 0 0 1 0 2.8ZM7.5 8.5h.01',
  caixa: 'M3 5h18v15H3zM3 10h18M7 15h3m4 0h3M7 3v2m10-2v2',
  lixeira: 'M9 3h6l1 2h4v2H4V5h4l1-2ZM6 9h12l-1 11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 9Zm3 2v8h2v-8H9Zm4 0v8h2v-8h-2Z',
  cadeado: 'M12 2a5 5 0 0 0-5 5v3H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V11a1 1 0 0 0-1-1h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z',
  sangria: 'M12 3v12m-5-5 5 5 5-5M5 19h14',
  suprimento: 'M12 21V9m-5 5 5-5 5 5M5 5h14',
}

function Icone({ nome, tracoForte = false }) {
  const iconesDeTracoForte = {
    busca: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
    preco: <><path d="m20 13-7 7a2 2 0 0 1-2.8 0L3 12V4h8l9 6.2a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="8" r=".8" /></>,
    pagar: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M3 9h18" /><circle cx="12" cy="14" r="2.2" /></>,
    lixeira: <><path d="M3.5 6.5h17M9 6.5V4h6v2.5M6.5 6.5l1 14h9l1-14" /><path d="M10 10v7m4-7v7" /></>,
    cadeado: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M7 10V7a5 5 0 0 1 10 0v3" /><path d="M12 14v3" /></>,
  }
  return (
    <svg
      className={`pdv-icone${tracoForte ? ' pdv-icone-traco-forte' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={nome === 'lixeira' ? 2.8 : tracoForte ? 2.5 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {tracoForte || nome === 'lixeira' ? iconesDeTracoForte[nome] : <path d={CAMINHOS[nome]} />}
    </svg>
  )
}

const totalDaLinha = (precoCentavos, quantidadeMilesimos) =>
  Math.round((precoCentavos * quantidadeMilesimos) / 1000)

const semSimbolo = (centavos) => currency(centavos).replace(/R\$\s*/, '')

const formatarQuantidade = (milesimos) =>
  (milesimos / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

// ---------------------------------------------------------------
// Entrada: caixa fechado ou aberto
// ---------------------------------------------------------------
export default function CashRegister(props) {
  return props.cash ? <Register {...props} /> : <OpenCash {...props} />
}

function OpenCash({ operators, onRefresh, onError, onSuccess }) {
  const [operatorName, setOperatorName] = useState('')
  const [operatorId, setOperatorId] = useState(operators[0]?.id || '')
  const [opening, setOpening] = useState('')
  const [cadastrandoOperador, setCadastrandoOperador] = useState(false)
  const [salvandoOperador, setSalvandoOperador] = useState(false)

  async function startCash(event) {
    event.preventDefault()
    try {
      let id = operatorId || operators[0]?.id || ''
      if (!id) {
        if (!operatorName.trim()) throw new Error('Informe o nome do operador.')
        const operator = await api('/usuarios', { method: 'POST', body: JSON.stringify({ nome: operatorName }) })
        id = operator.id
      }
      const abertura = decimalToCents(opening || '0')
      if (!Number.isFinite(abertura) || abertura < 0) throw new Error('Valor inicial inválido.')
      await api('/caixa/abrir', {
        method: 'POST',
        body: JSON.stringify({ usuario_id: id, valor_abertura_centavos: abertura }),
      })
      onSuccess('Caixa aberto. Bom trabalho!')
      await onRefresh()
    } catch (requestError) {
      onError(requestError)
    }
  }

  async function cadastrarOperador(event) {
    event.preventDefault()
    const nome = operatorName.trim()
    if (!nome) {
      onError(new Error('Informe o nome do operador.'))
      return
    }

    setSalvandoOperador(true)
    try {
      const operador = await api('/usuarios', {
        method: 'POST',
        body: JSON.stringify({ nome }),
      })
      await onRefresh()
      setOperatorId(operador.id)
      setOperatorName('')
      setCadastrandoOperador(false)
      onSuccess('Operador cadastrado. Você já pode abrir o caixa com este usuário.')
    } catch (requestError) {
      onError(requestError)
    } finally {
      setSalvandoOperador(false)
    }
  }

  return (
    <div className="page-wrap">
      <PageHeading eyebrow="OPERAÇÃO" title="Frente de caixa" description="Abra o caixa para começar a registrar as vendas." />
      <div className="open-cash-wrap">
        <div className="open-cash-icon"><Icone nome="caixa" /></div>
        <h2>Caixa fechado</h2>
        <p>Informe quem vai operar e o valor inicial em dinheiro no caixa.</p>
        <form className="form-stack" onSubmit={cadastrandoOperador ? cadastrarOperador : startCash}>
          {operators.length > 0 && !cadastrandoOperador ? (
            <label>Operador
              <select value={operatorId || operators[0]?.id || ''} onChange={(event) => setOperatorId(event.target.value)}>
                {operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.nome}</option>)}
              </select>
            </label>
          ) : (
            <label>Nome do operador
              <input value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="Ex.: Maria" required disabled={salvandoOperador} />
            </label>
          )}
          {operators.length > 0 && !cadastrandoOperador && (
            <button type="button" className="button button-secondary button-full" onClick={() => setCadastrandoOperador(true)}>
              Cadastrar operador
            </button>
          )}
          {cadastrandoOperador ? (
            <>
              <button className="button button-primary button-full" disabled={salvandoOperador}>
                {salvandoOperador ? 'Salvando operador...' : 'Salvar operador'}
              </button>
              <button type="button" className="button button-secondary button-full" disabled={salvandoOperador} onClick={() => { setCadastrandoOperador(false); setOperatorName('') }}>
                Voltar para operadores
              </button>
            </>
          ) : (
            <>
              <label>Valor inicial no caixa
                <input inputMode="decimal" value={opening} onChange={(event) => setOpening(event.target.value)} placeholder="R$ 0,00" />
              </label>
              <button className="button button-primary button-full">Abrir caixa</button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Caixa aberto: tela de venda
// ---------------------------------------------------------------
function Register({ cash, onRefresh, onError, onSuccess }) {
  const [search, setSearch] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [suggestionIndex, setSuggestionIndex] = useState(-1)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState('')
  const [cart, setCart] = useState([])
  const [modal, setModal] = useState(null) // 'buscar' | 'consultar' | 'pagar' | 'fechar' | 'movimentacao'
  const [tipoMovimentacao, setTipoMovimentacao] = useState('SANGRIA')
  const [buscaInicial, setBuscaInicial] = useState('')
  const [editando, setEditando] = useState(null) // { id, texto }
  const [itemSelecionadoId, setItemSelecionadoId] = useState(null)
  const [concluida, setConcluida] = useState(null) // { total, troco }
  const inputRef = useRef(null)
  const listaRef = useRef(null)
  const manterFocoLista = useRef(false)
  const cancelarEdicao = useRef(false)
  const querySugestoes = search.trim().replace(/^([\d.,]+)\s*\*\s*/, '').trim()

  const total = cart.reduce((soma, linha) => soma + linha.total_centavos, 0)
  const itens = cart.reduce(
    (soma, linha) => soma + (linha.unidade === 'UN' ? linha.quantidade_milesimos / 1000 : 1),
    0,
  )

  // Após adicionar produto, o foco volta ao leitor; na navegação do carrinho,
  // mantém-se na lista para permitir editar várias quantidades em sequência.
  useEffect(() => {
    if (!modal && !concluida && !editando && !manterFocoLista.current) inputRef.current?.focus()
    manterFocoLista.current = false
  }, [modal, concluida, editando, cart])

  useEffect(() => {
    if (querySugestoes.length < 2) return undefined

    let cancelado = false
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true)
      setSuggestionsError('')
      try {
        const produtos = await api(`/produtos?busca=${encodeURIComponent(querySugestoes)}&limite=8`)
        if (!cancelado) {
          setSuggestions(produtos)
          setSuggestionIndex(-1)
        }
      } catch (erro) {
        if (!cancelado) {
          setSuggestions([])
          setSuggestionsError(erro.message)
        }
      } finally {
        if (!cancelado) setSuggestionsLoading(false)
      }
    }, 180)
    return () => {
      cancelado = true
      window.clearTimeout(timer)
    }
  }, [querySugestoes])

  // Atalhos do teclado.
  useEffect(() => {
    if (modal || concluida) return undefined
    function aoTeclar(evento) {
      const acoes = {
        F1: () => abrirBusca('buscar'),
        F3: abrirPagamento,
        F4: () => abrirBusca('consultar'),
        F8: limpar,
        F10: () => setModal('fechar'),
      }
      const acao = acoes[evento.key]
      if (!acao) return
      evento.preventDefault()
      acao()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  })

  function abrirBusca(tipo, texto = '') {
    setBuscaInicial(texto)
    setModal(tipo)
  }

  function abrirPagamento() {
    if (!cart.length) {
      onError(new Error('Adicione ao menos um produto antes de pagar.'))
      return
    }
    setModal('pagar')
  }

  function limpar() {
    if (cart.length && window.confirm('Limpar todos os itens da venda?')) setCart([])
  }

  async function encontrarProduto(consulta) {
    try {
      return await api(`/produtos/codigo/${encodeURIComponent(consulta)}`)
    } catch (erro) {
      if (!erro.message.includes('não encontrado')) throw erro
    }
    const achados = await api(`/produtos?busca=${encodeURIComponent(consulta)}&limite=10`)
    if (achados.length === 0) throw new Error('Produto não encontrado. Confira o código ou o nome.')
    const exato = achados.find((produto) => produto.nome.toLowerCase() === consulta.toLowerCase())
    if (exato) return exato
    if (achados.length === 1) return achados[0]
    return null // vários resultados: a pessoa escolhe na busca
  }

  async function adicionar(evento) {
    evento.preventDefault()
    const digitado = search.trim()
    if (!digitado) return

    // "3*código" vende 3 unidades; "0,350*código" vende 350 g.
    let quantidade = 1000
    let consulta = digitado
    const comQuantidade = digitado.match(/^([\d.,]+)\s*\*\s*(.+)$/)
    if (comQuantidade) {
      quantidade = toMilesimos(comQuantidade[1])
      consulta = comQuantidade[2].trim()
      if (!Number.isFinite(quantidade) || quantidade <= 0) {
        onError(new Error('Quantidade inválida.'))
        return
      }
    }

    try {
      const produto = await encontrarProduto(consulta)
      if (!produto) {
        setSearch('')
        abrirBusca('buscar', consulta)
        return
      }
      inserir(produto, quantidade)
    } catch (erro) {
      onError(erro)
    }
  }

  function selecionarSugestao(produto) {
    const digitado = search.trim()
    const comQuantidade = digitado.match(/^([\d.,]+)\s*\*\s*(.+)$/)
    const quantidade = comQuantidade ? toMilesimos(comQuantidade[1]) : 1000
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      onError(new Error('Quantidade inválida.'))
      return
    }
    setSuggestionsOpen(false)
    inserir(produto, quantidade)
  }

  function navegarSugestoes(evento) {
    if (evento.key === 'ArrowDown' && suggestionsOpen && suggestions.length) {
      evento.preventDefault()
      setSuggestionIndex((indice) => (indice + 1) % suggestions.length)
    } else if (evento.key === 'ArrowUp' && suggestionsOpen && suggestions.length) {
      evento.preventDefault()
      setSuggestionIndex((indice) => (indice <= 0 ? suggestions.length - 1 : indice - 1))
    } else if (evento.key === 'Enter' && suggestionsOpen && suggestionIndex >= 0) {
      evento.preventDefault()
      selecionarSugestao(suggestions[suggestionIndex])
    } else if (evento.key === 'Escape' && suggestionsOpen) {
      evento.preventDefault()
      setSuggestionsOpen(false)
      setSuggestionIndex(-1)
    } else if (evento.key === 'ArrowDown' && cart.length) {
      evento.preventDefault()
      selecionarItemCarrinho(0)
    } else if (evento.key === 'ArrowUp' && cart.length) {
      evento.preventDefault()
      selecionarItemCarrinho(cart.length - 1)
    }
  }

  function selecionarItemCarrinho(indice) {
    if (!cart.length) return
    const indiceSeguro = Math.max(0, Math.min(indice, cart.length - 1))
    setItemSelecionadoId(cart[indiceSeguro].id)
    listaRef.current?.focus()
  }

  function navegarCarrinho(evento) {
    if (evento.target.matches('input, textarea, select, button, [contenteditable="true"]')) return
    const indice = cart.findIndex((linha) => linha.id === itemSelecionadoId)

    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault()
      selecionarItemCarrinho(indice < 0 ? 0 : indice + (evento.key === 'ArrowDown' ? 1 : -1))
      return
    }

    if (indice < 0) return
    const linha = cart[indice]
    const passo = linha.unidade === 'UN' ? 1000 : 100

    if (evento.key === 'Delete') {
      evento.preventDefault()
      const restantes = cart.filter((item) => item.id !== linha.id)
      setCart(restantes)
      setItemSelecionadoId(restantes[Math.min(indice, restantes.length - 1)]?.id ?? null)
      manterFocoLista.current = restantes.length > 0
      if (restantes.length === 0) window.setTimeout(() => inputRef.current?.focus(), 0)
    } else if (evento.key === 'Enter') {
      evento.preventDefault()
      setEditando({ id: linha.id, texto: milesimosToInput(linha.quantidade_milesimos) })
    } else if (evento.key === '+' || evento.key === '=' || evento.key === 'NumpadAdd') {
      evento.preventDefault()
      manterFocoLista.current = true
      mudarQuantidade(linha.id, passo)
    } else if (evento.key === '-' || evento.key === 'NumpadSubtract') {
      evento.preventDefault()
      manterFocoLista.current = true
      mudarQuantidade(linha.id, -passo)
    } else if (/^[0-9]$/.test(evento.key) || evento.key === ',' || evento.key === '.') {
      evento.preventDefault()
      setEditando({ id: linha.id, texto: /^[0-9]$/.test(evento.key) ? evento.key : `0${evento.key}` })
    } else if (evento.key === 'Escape') {
      evento.preventDefault()
      inputRef.current?.focus()
    } else if (evento.key.length === 1 && /\p{L}/u.test(evento.key)) {
      evento.preventDefault()
      setSearch(evento.key)
      setSuggestionsOpen(true)
      setSuggestionIndex(-1)
      inputRef.current?.focus()
    }
  }

  function inserir(produto, quantidade = 1000) {
    if (produto.unidade === 'UN') quantidade = Math.max(1000, Math.round(quantidade / 1000) * 1000)
    const jaNaVenda = cart.some((linha) => linha.id === produto.id)

    setCart((atual) => {
      const existente = atual.find((linha) => linha.id === produto.id)
      if (existente) {
        const nova = existente.quantidade_milesimos + quantidade
        return atual.map((linha) => (linha.id === produto.id
          ? { ...linha, quantidade_milesimos: nova, total_centavos: totalDaLinha(linha.preco_venda_centavos, nova) }
          : linha))
      }
      const linha = {
        id: produto.id,
        nome: produto.nome,
        unidade: produto.unidade,
        preco_venda_centavos: produto.preco_venda_centavos,
        estoque_milesimos: produto.estoque_milesimos,
        quantidade_milesimos: quantidade,
        total_centavos: totalDaLinha(produto.preco_venda_centavos, quantidade),
      }
      return [linha, ...atual] // o último item lido aparece no topo
    })

    setSearch('')
    setModal(null)
    // Produto de peso ou volume: já abre o campo para digitar a quantidade.
    setEditando(produto.unidade !== 'UN' && quantidade === 1000 && !jaNaVenda ? { id: produto.id, texto: '' } : null)
  }

  function mudarQuantidade(id, delta) {
    setCart((atual) => atual.flatMap((linha) => {
      if (linha.id !== id) return [linha]
      const nova = linha.quantidade_milesimos + delta
      if (nova <= 0) return []
      return [{ ...linha, quantidade_milesimos: nova, total_centavos: totalDaLinha(linha.preco_venda_centavos, nova) }]
    }))
  }

  function confirmarQuantidade(linha, texto, focarLista = false) {
    setEditando(null)
    if (focarLista) window.setTimeout(() => listaRef.current?.focus(), 0)
    if (!texto.trim()) return
    let nova = toMilesimos(texto)
    if (!Number.isFinite(nova) || nova <= 0) {
      onError(new Error('Quantidade inválida.'))
      return
    }
    if (linha.unidade === 'UN') nova = Math.max(1000, Math.round(nova / 1000) * 1000)
    setCart((atual) => atual.map((item) => (item.id === linha.id
      ? { ...item, quantidade_milesimos: nova, total_centavos: totalDaLinha(item.preco_venda_centavos, nova) }
      : item)))
  }

  function remover(id) {
    setCart((atual) => atual.filter((linha) => linha.id !== id))
  }

  async function concluir(pagamentos, clienteId) {
    try {
      const resultado = await api('/vendas', {
        method: 'POST',
        body: JSON.stringify({
          sessao_id: cash.id,
          cliente_id: clienteId,
          itens: cart.map((linha) => ({ produto_id: linha.id, quantidade_milesimos: linha.quantidade_milesimos })),
          pagamentos,
        }),
      })
      setConcluida({
        total: resultado?.total_centavos ?? total,
        troco: pagamentos.reduce((soma, pagamento) => soma + pagamento.troco_centavos, 0),
      })
      setCart([])
      setModal(null)
      await onRefresh()
    } catch (erro) {
      onError(erro)
    }
  }

  const horaAbertura = new Date(cash.aberto_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="pdv">
      <header className="pdv-topo">
        <div>
          <h1>Frente de caixa</h1>
          <p>{cash.usuario_nome ? `${cash.usuario_nome} · ` : ''}caixa aberto às {horaAbertura}</p>
        </div>
        <Relogio />
        <div className="pdv-top-acoes">
          <button type="button" className="pdv-movimento" onClick={() => { setTipoMovimentacao('SANGRIA'); setModal('movimentacao') }}><Icone nome="sangria" />Sangria</button>
          <button type="button" className="pdv-movimento" onClick={() => { setTipoMovimentacao('SUPRIMENTO'); setModal('movimentacao') }}><Icone nome="suprimento" />Suprimento</button>
          <button type="button" className="pdv-fechar" onClick={() => setModal('fechar')}>
            <Icone nome="cadeado" tracoForte /> Fechar caixa <span className="pdv-tecla">F10</span>
          </button>
        </div>
      </header>

      <div className="pdv-busca-com-sugestoes">
        <form className="pdv-leitor" onSubmit={adicionar}>
          <Icone nome="busca" tracoForte />
          <input
            ref={inputRef}
            autoFocus
            value={search}
            onChange={(evento) => {
              const valor = evento.target.value
              const consulta = valor.trim().replace(/^([\d.,]+)\s*\*\s*/, '').trim()
              setSearch(valor)
              setSuggestionsOpen(true)
              setSuggestionIndex(-1)
              setSuggestionsLoading(consulta.length >= 2)
              setSuggestionsError('')
              if (consulta.length < 2) setSuggestions([])
            }}
            onFocus={() => setSuggestionsOpen(true)}
            onKeyDown={navegarSugestoes}
            placeholder="Bipe o código de barras ou digite o nome do produto"
            aria-label="Código de barras ou nome do produto"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestionsOpen && querySugestoes.length >= 2 && (suggestionsLoading || suggestions.length > 0 || Boolean(suggestionsError))}
            aria-controls="pdv-produtos-sugestoes"
            aria-activedescendant={suggestionIndex >= 0 ? `pdv-produto-sugestao-${suggestionIndex}` : undefined}
          />
          <button type="submit">Adicionar</button>
        </form>
        {suggestionsOpen && querySugestoes.length >= 2 && (
          <div className="pdv-sugestoes" id="pdv-produtos-sugestoes" role="listbox" aria-label="Sugestões de produtos">
            {suggestionsLoading && <div className="pdv-sugestoes-mensagem">Buscando produtos…</div>}
            {!suggestionsLoading && suggestionsError && <div className="pdv-sugestoes-mensagem erro" role="alert">{suggestionsError}</div>}
            {!suggestionsLoading && !suggestionsError && suggestions.map((produto, indice) => (
              <button
                id={`pdv-produto-sugestao-${indice}`}
                key={produto.id}
                type="button"
                role="option"
                aria-selected={indice === suggestionIndex}
                className={indice === suggestionIndex ? 'ativa' : ''}
                onMouseDown={(evento) => evento.preventDefault()}
                onClick={() => selecionarSugestao(produto)}
              >
                <span className="pdv-sugestao-nome">{produto.nome}</span>
                <span className="pdv-sugestao-estoque">{qtyLabel(produto.estoque_milesimos, produto.unidade)} em estoque</span>
                <strong>{currency(produto.preco_venda_centavos)}</strong>
              </button>
            ))}
            {!suggestionsLoading && !suggestionsError && suggestions.length === 0 && (
              <div className="pdv-sugestoes-mensagem">Nenhum produto encontrado.</div>
            )}
          </div>
        )}
        <p className="pdv-dica">Na lista: ↑/↓ seleciona, Enter edita, +/− altera, Delete remove e letras voltam à busca. Também aceita 3*código ou 0,350*código.</p>
      </div>

      <section
        ref={listaRef}
        className="pdv-itens"
        aria-label="Itens da venda. Use as setas para selecionar, Enter para editar, mais ou menos para alterar."
        tabIndex={cart.length ? 0 : -1}
        onKeyDown={navegarCarrinho}
      >
        {cart.length === 0 ? (
          <div className="pdv-vazio">
            <strong>Nenhum item na venda</strong>
            <span>Bipe um código de barras ou digite o nome do produto.</span>
          </div>
        ) : (
          <ul>
            {cart.map((linha) => {
              const passo = linha.unidade === 'UN' ? 1000 : 100
              const acimaDoEstoque = linha.quantidade_milesimos > linha.estoque_milesimos
              return (
                <li
                  id={`pdv-item-${linha.id}`}
                  className={`pdv-linha ${itemSelecionadoId === linha.id ? 'selecionada' : ''}`}
                  key={linha.id}
                  onClick={(evento) => {
                    if (evento.target.matches('button, input')) return
                    setItemSelecionadoId(linha.id)
                    listaRef.current?.focus()
                  }}
                >
                  <div className="pdv-linha-nome">
                    <strong>{linha.nome}</strong>
                    <span>
                      {currency(linha.preco_venda_centavos)} / {linha.unidade.toLowerCase()}
                      {acimaDoEstoque && (
                        <em className="pdv-aviso">Estoque registrado: {qtyLabel(Math.max(linha.estoque_milesimos, 0), linha.unidade)}</em>
                      )}
                    </span>
                  </div>
                  <div className="pdv-qtd">
                    <button type="button" onClick={() => mudarQuantidade(linha.id, -passo)} aria-label={`Diminuir ${linha.nome}`}>−</button>
                    {editando?.id === linha.id ? (
                      <input
                        className="pdv-qtd-input"
                        autoFocus
                        inputMode="decimal"
                        value={editando.texto}
                        placeholder={formatarQuantidade(linha.quantidade_milesimos)}
                        aria-label={`Quantidade de ${linha.nome}`}
                        onChange={(evento) => setEditando({ id: linha.id, texto: evento.target.value })}
                        onBlur={(evento) => {
                          if (cancelarEdicao.current) {
                            cancelarEdicao.current = false
                            return
                          }
                          const focoDentroDaLista = listaRef.current?.contains(evento.relatedTarget)
                          confirmarQuantidade(linha, editando.texto, focoDentroDaLista)
                        }}
                        onKeyDown={(evento) => {
                          evento.stopPropagation()
                          if (evento.key === 'Enter') {
                            evento.preventDefault()
                            confirmarQuantidade(linha, editando.texto, true)
                          } else if (evento.key === 'Escape') {
                            evento.preventDefault()
                            cancelarEdicao.current = true
                            setEditando(null)
                            window.setTimeout(() => listaRef.current?.focus(), 0)
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="pdv-qtd-valor"
                        title="Clique para digitar a quantidade"
                        onClick={() => setEditando({ id: linha.id, texto: milesimosToInput(linha.quantidade_milesimos) })}
                      >
                        {formatarQuantidade(linha.quantidade_milesimos)}
                        {linha.unidade !== 'UN' && <small>{linha.unidade.toLowerCase()}</small>}
                      </button>
                    )}
                    <button type="button" onClick={() => mudarQuantidade(linha.id, passo)} aria-label={`Aumentar ${linha.nome}`}>+</button>
                  </div>
                  <strong className="pdv-linha-total">{currency(linha.total_centavos)}</strong>
                  <button type="button" className="pdv-remover" onClick={() => remover(linha.id)} aria-label={`Remover ${linha.nome}`}>
                    <Icone nome="lixeira" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <footer className="pdv-rodape">
        <div className="pdv-contagem">
          <span>Itens</span>
          <strong>{itens.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</strong>
        </div>
        <div className="pdv-total" aria-live="polite">
          <span>Total a pagar</span>
          <strong><small>R$</small>{semSimbolo(total)}</strong>
        </div>
      </footer>

      <nav className="pdv-acoes" aria-label="Ações da venda">
        <button type="button" className="pdv-acao buscar" onClick={() => abrirBusca('buscar')}>
          <Icone nome="busca" tracoForte />
          <span className="pdv-acao-texto"><span className="pdv-acao-titulo"><strong>Buscar</strong><span className="pdv-tecla">F1</span></span></span>
        </button>
        <button type="button" className="pdv-acao consultar" onClick={() => abrirBusca('consultar')}>
          <Icone nome="preco" tracoForte />
          <span className="pdv-acao-texto"><span className="pdv-acao-titulo"><strong>Preço</strong><span className="pdv-tecla">F4</span></span></span>
        </button>
        <button type="button" className="pdv-acao limpar" onClick={limpar} disabled={!cart.length}>
          <Icone nome="lixeira" tracoForte />
          <span className="pdv-acao-texto"><span className="pdv-acao-titulo"><strong>Limpar</strong><span className="pdv-tecla">F8</span></span></span>
        </button>
        <button type="button" className="pdv-acao pagar" onClick={abrirPagamento} disabled={!cart.length}>
          <Icone nome="pagar" tracoForte />
          <span className="pdv-acao-texto"><span className="pdv-acao-titulo"><strong>Pagar</strong><span className="pdv-tecla">F3</span></span></span>
        </button>
      </nav>

      {(modal === 'buscar' || modal === 'consultar') && (
        <BuscaModal
          modo={modal}
          inicial={buscaInicial}
          onEscolher={(produto) => inserir(produto)}
          onFechar={() => setModal(null)}
        />
      )}
      {modal === 'pagar' && (
        <PagarModal total={total} onConcluir={concluir} onFechar={() => setModal(null)} />
      )}
      {modal === 'fechar' && (
        <FecharCaixaModal
          cash={cash}
          onFechar={() => setModal(null)}
          onRefresh={onRefresh}
          onError={onError}
          onSuccess={onSuccess}
        />
      )}
      {modal === 'movimentacao' && (
        <MovimentacaoCaixaModal
          tipo={tipoMovimentacao}
          onFechar={() => setModal(null)}
          onRefresh={onRefresh}
          onError={onError}
          onSuccess={onSuccess}
        />
      )}
      {concluida && (
        <VendaConcluida total={concluida.total} troco={concluida.troco} onFechar={() => setConcluida(null)} />
      )}
    </div>
  )
}

function Relogio() {
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const intervalo = window.setInterval(() => setAgora(new Date()), 20000)
    return () => window.clearInterval(intervalo)
  }, [])
  return (
    <time className="pdv-relogio" dateTime={agora.toISOString()}>
      {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
    </time>
  )
}

// ---------------------------------------------------------------
// Janelas (modais)
// ---------------------------------------------------------------
function Modal({ titulo, onFechar, largura, onArrowNavigation, onEscape, children }) {
  function aoTeclar(evento) {
    if (evento.key === 'Escape') {
      if (onEscape?.()) {
        evento.preventDefault()
        return
      }
      onFechar()
      return
    }
    if (!evento.defaultPrevented && onArrowNavigation?.(evento)) return
    if (evento.key !== 'Tab') return

    const modal = evento.currentTarget
    const focaveis = [...modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((elemento) => elemento.getClientRects().length > 0)
    if (focaveis.length === 0) return

    const primeiro = focaveis[0]
    const ultimo = focaveis[focaveis.length - 1]
    if (evento.shiftKey && (document.activeElement === primeiro || !modal.contains(document.activeElement))) {
      evento.preventDefault()
      ultimo.focus()
    } else if (!evento.shiftKey && (document.activeElement === ultimo || !modal.contains(document.activeElement))) {
      evento.preventDefault()
      primeiro.focus()
    }
  }

  return (
    <div className="pdv-modal-fundo" role="presentation" onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onFechar() }}>
      <section className="pdv-modal" role="dialog" aria-modal="true" aria-label={titulo} onKeyDown={aoTeclar} style={largura ? { maxWidth: largura } : undefined}>
        <header>
          <h2>{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar">×</button>
        </header>
        {children}
      </section>
    </div>
  )
}

// Busca por nome ou código. No modo "consultar" só mostra preço e estoque.
function BuscaModal({ modo, inicial, onEscolher, onFechar }) {
  const [texto, setTexto] = useState(inicial)
  const [lista, setLista] = useState([])
  const [indice, setIndice] = useState(0)
  const [mensagem, setMensagem] = useState('')
  const [detalhe, setDetalhe] = useState(null)

  useEffect(() => {
    let cancelado = false
    const espera = window.setTimeout(async () => {
      try {
        const resposta = await api(`/produtos?busca=${encodeURIComponent(texto.trim())}&limite=20`)
        if (cancelado) return
        setLista(resposta)
        setIndice(0)
        setMensagem('')
      } catch (erro) {
        if (!cancelado) {
          setLista([])
          setMensagem(erro.message)
        }
      }
    }, 180)
    return () => {
      cancelado = true
      window.clearTimeout(espera)
    }
  }, [texto])

  function escolher(produto) {
    if (!produto) return
    if (modo === 'consultar') setDetalhe(produto)
    else onEscolher(produto)
  }

  function aoTeclar(evento) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      setIndice((atual) => Math.min(atual + 1, lista.length - 1))
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      setIndice((atual) => Math.max(atual - 1, 0))
    } else if (evento.key === 'Enter') {
      evento.preventDefault()
      escolher(lista[indice])
    }
  }

  return (
    <Modal titulo={modo === 'consultar' ? 'Consultar preço' : 'Buscar produto'} onFechar={onFechar} largura={680}>
      <input
        className="pdv-busca-campo"
        autoFocus
        value={texto}
        onChange={(evento) => { setTexto(evento.target.value); setDetalhe(null) }}
        onKeyDown={aoTeclar}
        placeholder="Nome ou código de barras"
        aria-label="Nome ou código de barras"
      />
      {detalhe ? (
        <div className="pdv-detalhe">
          <span>{detalhe.nome}</span>
          <strong>{currency(detalhe.preco_venda_centavos)}</strong>
          <small>
            por {detalhe.unidade.toLowerCase()} · {qtyLabel(detalhe.estoque_milesimos, detalhe.unidade)} em estoque
            {detalhe.codigo_barras ? ` · código ${detalhe.codigo_barras}` : ''}
          </small>
        </div>
      ) : (
        <>
          {mensagem && <p className="pdv-erro">{mensagem}</p>}
          <ul className="pdv-resultados">
            {lista.map((produto, posicao) => (
              <li key={produto.id}>
                <button type="button" className={posicao === indice ? 'ativo' : ''} onClick={() => escolher(produto)}>
                  <span className="nome">{produto.nome}</span>
                  <span className="estoque">{qtyLabel(produto.estoque_milesimos, produto.unidade)}</span>
                  <strong>{currency(produto.preco_venda_centavos)}</strong>
                </button>
              </li>
            ))}
            {!mensagem && lista.length === 0 && <li className="pdv-sem-resultado">Nenhum produto encontrado.</li>}
          </ul>
        </>
      )}
    </Modal>
  )
}

// Pagamento: aceita mais de uma forma (ex.: parte em dinheiro, parte no Pix).
function PagarModal({ total, onConcluir, onFechar }) {
  const [forma, setForma] = useState('DINHEIRO')
  const [valor, setValor] = useState('')
  const [pagamentos, setPagamentos] = useState([])
  const [clientes, setClientes] = useState([])
  const [clienteId, setClienteId] = useState('')
  const [clienteListaAberta, setClienteListaAberta] = useState(false)
  const [clienteOpcaoIndice, setClienteOpcaoIndice] = useState(0)
  const [novoCliente, setNovoCliente] = useState(false)
  const [nomeCliente, setNomeCliente] = useState('')
  const [telefoneCliente, setTelefoneCliente] = useState('')
  const [salvandoCliente, setSalvandoCliente] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [enviando, setEnviando] = useState(false)
  const valorRef = useRef(null)
  const concluirRef = useRef(null)
  const formasRef = useRef([])
  const modalRef = useRef(null)
  const clienteSelectRef = useRef(null)
  const clienteListaRef = useRef(null)
  const nomeClienteRef = useRef(null)

  useEffect(() => {
    let cancelado = false
    api('/clientes')
      .then((resposta) => {
        if (!cancelado) setClientes(resposta)
      })
      .catch((erro) => {
        if (!cancelado) setMensagem(erro.message)
      })
    return () => { cancelado = true }
  }, [])

  const pago = pagamentos.reduce((soma, pagamento) => soma + pagamento.valor_centavos, 0)
  const restante = total - pago
  const digitado = valor.trim() ? decimalToCents(valor) : restante
  const trocoPrevisto = forma === 'DINHEIRO' && Number.isFinite(digitado) ? Math.max(0, digitado - restante) : 0
  const fiadoAdicionado = pagamentos.some((pagamento) => pagamento.forma === 'FIADO')

  useEffect(() => {
    if (restante <= 0) concluirRef.current?.focus()
    else valorRef.current?.focus()
  }, [restante, pagamentos.length])

  useEffect(() => {
    if (novoCliente) nomeClienteRef.current?.focus()
  }, [novoCliente])

  function adicionarPagamento(evento) {
    evento.preventDefault()
    if (restante <= 0) return
    if (forma === 'FIADO' && !clienteId) {
      setMensagem('Selecione ou cadastre um cliente para pagar no fiado.')
      return
    }
    if (!Number.isFinite(digitado) || digitado <= 0) {
      setMensagem('Digite um valor válido.')
      return
    }
    if (forma !== 'DINHEIRO' && digitado > restante) {
      setMensagem('O valor é maior do que falta pagar.')
      return
    }
    const aplicado = Math.min(digitado, restante)
    setPagamentos([
      ...pagamentos,
      { forma, valor_centavos: aplicado, troco_centavos: forma === 'DINHEIRO' ? digitado - aplicado : 0 },
    ])
    setValor('')
    setMensagem('')
  }

  async function cadastrarCliente() {
    if (!nomeCliente.trim()) {
      setMensagem('Informe o nome do cliente.')
      return
    }
    setSalvandoCliente(true)
    try {
      const cliente = await api('/clientes', {
        method: 'POST',
        body: JSON.stringify({ nome: nomeCliente, telefone: telefoneCliente }),
      })
      setClientes((atuais) => [...atuais, cliente].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
      setClienteId(cliente.id)
      setNomeCliente('')
      setTelefoneCliente('')
      setNovoCliente(false)
      setMensagem('')
    } catch (erro) {
      setMensagem(erro.message)
    } finally {
      setSalvandoCliente(false)
    }
  }

  async function concluir() {
    setEnviando(true)
    try {
      const clienteFiado = pagamentos.some((pagamento) => pagamento.forma === 'FIADO') ? clienteId : undefined
      await onConcluir(pagamentos, clienteFiado)
    } finally {
      setEnviando(false)
    }
  }

  function navegarFormas(evento, indice) {
    const deslocamento = evento.key === 'ArrowRight'
      ? 1
      : evento.key === 'ArrowLeft'
        ? -1
        : 0
    if (!deslocamento) return
    evento.preventDefault()
    const proximo = (indice + deslocamento + FORMAS.length) % FORMAS.length
    const item = FORMAS[proximo]
    setForma(item.id)
    formasRef.current[proximo]?.focus()
  }

  function navegarControles(evento) {
    const alvo = evento.target
    const tecla = evento.key
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(tecla)) return false

    if (alvo === valorRef.current && tecla === 'ArrowRight') {
      evento.preventDefault()
      setValor((restante / 100).toFixed(2).replace('.', ','))
      return true
    }

    if (alvo.matches('[role="radio"]') && (tecla === 'ArrowLeft' || tecla === 'ArrowRight')) return false
    if (alvo instanceof HTMLSelectElement && (tecla === 'ArrowUp' || tecla === 'ArrowDown')) return false
    if ((alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement)
      && (tecla === 'ArrowLeft' || tecla === 'ArrowRight')) return false

    const proximo = tecla === 'ArrowDown' || tecla === 'ArrowRight'
    const controles = [...modalRef.current.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((elemento) => elemento.tabIndex >= 0 && elemento.getClientRects().length > 0)
    if (!controles.length) return false

    const indiceAtual = controles.indexOf(alvo)
    const indiceSeguinte = indiceAtual < 0
      ? (proximo ? 0 : controles.length - 1)
      : (indiceAtual + (proximo ? 1 : -1) + controles.length) % controles.length
    evento.preventDefault()
    controles[indiceSeguinte].focus()
    return true
  }

  function voltarParaSelecionarCliente() {
    setNovoCliente(false)
    setNomeCliente('')
    setTelefoneCliente('')
    setMensagem('')
    window.setTimeout(() => clienteSelectRef.current?.focus(), 0)
  }

  function alternarListaClientes() {
    if (fiadoAdicionado) return
    const indiceSelecionado = clientes.findIndex((cliente) => cliente.id === clienteId)
    setClienteOpcaoIndice(indiceSelecionado >= 0 ? indiceSelecionado : 0)
    setClienteListaAberta((aberta) => !aberta)
  }

  function escolherCliente(cliente) {
    setClienteId(cliente.id)
    setClienteListaAberta(false)
    clienteSelectRef.current?.focus()
  }

  function navegarClientes(evento) {
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault()
      if (clienteListaAberta) {
        const cliente = clientes[clienteOpcaoIndice]
        if (cliente) escolherCliente(cliente)
      } else {
        alternarListaClientes()
      }
      return
    }
    if (evento.key === 'Escape' && clienteListaAberta) {
      evento.preventDefault()
      evento.stopPropagation()
      setClienteListaAberta(false)
      return
    }
    if (!clienteListaAberta || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(evento.key)) return
    evento.preventDefault()
    const indice = evento.key === 'Home'
      ? 0
      : evento.key === 'End'
        ? clientes.length - 1
        : Math.max(0, Math.min(clientes.length - 1, clienteOpcaoIndice + (evento.key === 'ArrowDown' ? 1 : -1)))
    setClienteOpcaoIndice(indice)
    clienteListaRef.current?.querySelectorAll('[role="option"]')[indice]?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <Modal
      titulo="Pagamento"
      onFechar={onFechar}
      largura={640}
      onArrowNavigation={navegarControles}
      onEscape={() => {
        if (!novoCliente) return false
        voltarParaSelecionarCliente()
        return true
      }}
    >
      <div ref={modalRef}>
      <div className="pdv-pagar-resumo">
        <div>
          <span>Total da venda</span>
          <strong>{currency(total)}</strong>
        </div>
        <div className={restante > 0 ? 'falta' : 'pago'}>
          <span>{restante > 0 ? 'Falta pagar' : 'Pago'}</span>
          <strong>{currency(restante > 0 ? restante : pago)}</strong>
        </div>
      </div>

      {pagamentos.length > 0 && (
        <ul className="pdv-pagamentos">
          {pagamentos.map((pagamento, posicao) => (
            <li key={`${pagamento.forma}-${posicao}`}>
              <span>{FORMAS.find((item) => item.id === pagamento.forma)?.nome}</span>
              <strong>{currency(pagamento.valor_centavos)}</strong>
              {pagamento.troco_centavos > 0 && <em>troco {currency(pagamento.troco_centavos)}</em>}
              <button type="button" onClick={() => setPagamentos(pagamentos.filter((_, indice) => indice !== posicao))} aria-label="Remover pagamento">×</button>
            </li>
          ))}
        </ul>
      )}

      {restante > 0 && (
        <form onSubmit={adicionarPagamento}>
          <div className="pdv-formas" role="radiogroup" aria-label="Forma de pagamento">
            {FORMAS.map((item) => (
              <button
                key={item.id}
                ref={(elemento) => { formasRef.current[FORMAS.indexOf(item)] = elemento }}
                type="button"
                role="radio"
                aria-checked={forma === item.id}
                tabIndex={forma === item.id ? 0 : -1}
                className={forma === item.id ? 'ativa' : ''}
                onClick={() => {
                  setForma(item.id)
                  setClienteListaAberta(false)
                }}
                onKeyDown={(evento) => navegarFormas(evento, FORMAS.indexOf(item))}
              >
                {item.nome}
              </button>
            ))}
          </div>
            {forma === 'FIADO' && (
              <div className="pdv-cliente-fiado">
                {!novoCliente ? (
                  <>
                    <div className="pdv-campo">
                      Cliente
                      <div className="pdv-cliente-seletor">
                        <button
                          ref={clienteSelectRef}
                          type="button"
                          className="pdv-cliente-combobox"
                          role="combobox"
                          aria-label="Cliente"
                          aria-expanded={clienteListaAberta}
                          aria-controls="pdv-clientes-lista"
                          aria-activedescendant={clienteListaAberta && clientes[clienteOpcaoIndice] ? `pdv-cliente-opcao-${clientes[clienteOpcaoIndice].id}` : undefined}
                          aria-haspopup="listbox"
                          disabled={fiadoAdicionado}
                          onClick={alternarListaClientes}
                          onKeyDown={navegarClientes}
                        >
                          {clientes.find((cliente) => cliente.id === clienteId)?.nome || 'Selecione um cliente'}
                          <span aria-hidden="true">▾</span>
                        </button>
                        {clienteListaAberta && (
                          <ul ref={clienteListaRef} className="pdv-clientes-lista" id="pdv-clientes-lista" role="listbox" aria-label="Clientes cadastrados">
                            {clientes.map((cliente, indice) => (
                              <li
                                key={cliente.id}
                                id={`pdv-cliente-opcao-${cliente.id}`}
                                role="option"
                                aria-selected={clienteId === cliente.id}
                                className={indice === clienteOpcaoIndice ? 'ativa' : ''}
                                onMouseDown={(evento) => evento.preventDefault()}
                                onClick={() => escolherCliente(cliente)}
                              >
                                {cliente.nome}{cliente.telefone ? ` · ${cliente.telefone}` : ''}
                              </li>
                            ))}
                            {clientes.length === 0 && <li className="pdv-clientes-vazio">Nenhum cliente cadastrado.</li>}
                          </ul>
                        )}
                      </div>
                    </div>
                    {!fiadoAdicionado && <button type="button" className="pdv-botao-secundario" onClick={() => { setMensagem(''); setNovoCliente(true) }}>Cadastrar cliente</button>}
                  </>
                ) : (
                  <>
                    <label className="pdv-campo">
                      Nome do cliente
                      <input ref={nomeClienteRef} value={nomeCliente} onChange={(evento) => setNomeCliente(evento.target.value)} />
                    </label>
                    <label className="pdv-campo">
                      Telefone (opcional)
                      <input value={telefoneCliente} onChange={(evento) => setTelefoneCliente(evento.target.value)} />
                    </label>
                    <div className="pdv-cliente-acoes">
                      <button type="button" className="pdv-botao-secundario" disabled={salvandoCliente} onClick={voltarParaSelecionarCliente}>Voltar para clientes</button>
                      <button type="button" className="pdv-botao-secundario" disabled={salvandoCliente} onClick={cadastrarCliente}>{salvandoCliente ? 'Salvando...' : 'Salvar cliente'}</button>
                    </div>
                  </>
                )}
              </div>
            )}
            <label className="pdv-campo">
            {forma === 'DINHEIRO' ? 'Valor recebido' : 'Valor neste pagamento'}
            <input
              ref={valorRef}
              inputMode="decimal"
              value={valor}
              onChange={(evento) => setValor(evento.target.value)}
              placeholder={semSimbolo(restante)}
            />
          </label>
          {trocoPrevisto > 0 && <p className="pdv-troco-previsto">Troco: <strong>{currency(trocoPrevisto)}</strong></p>}
          {mensagem && <p className="pdv-erro">{mensagem}</p>}
          <button type="submit" className="pdv-botao-secundario" disabled={forma === 'FIADO' && !clienteId}>
            {valor.trim() ? 'Adicionar pagamento' : forma === 'FIADO' ? `Lançar ${currency(restante)} no fiado` : `Pagar ${currency(restante)} no ${FORMAS.find((item) => item.id === forma).nome.toLowerCase()}`}
          </button>
        </form>
      )}

      <button ref={concluirRef} type="button" className="pdv-concluir" disabled={restante > 0 || enviando} onClick={concluir}>
        {enviando ? 'Registrando...' : 'Concluir venda'}
      </button>
      </div>
    </Modal>
  )
}

function VendaConcluida({ total, troco, onFechar }) {
  const botaoRef = useRef(null)
  useEffect(() => {
    botaoRef.current?.focus()
  }, [])

  return (
    <Modal titulo="Venda concluída" onFechar={onFechar} largura={520}>
      <div className="pdv-concluida">
        <span>Total</span>
        <strong>{currency(total)}</strong>
        {troco > 0 && (
          <>
            <span className="troco">Troco para o cliente</span>
            <strong className="troco">{currency(troco)}</strong>
          </>
        )}
      </div>
      <button ref={botaoRef} type="button" className="pdv-concluir" onClick={onFechar}>Nova venda</button>
    </Modal>
  )
}

function FecharCaixaModal({ cash, onFechar, onRefresh, onError, onSuccess }) {
  const [contado, setContado] = useState('')

  async function fechar(evento) {
    evento.preventDefault()
    const centavos = decimalToCents(contado)
    if (!Number.isFinite(centavos) || centavos < 0) {
      onError(new Error('Informe o valor contado na gaveta.'))
      return
    }
    try {
      const resultado = await api('/caixa/fechar', {
        method: 'POST',
        body: JSON.stringify({ valor_contado_centavos: centavos }),
      })
      onSuccess(`Caixa fechado. Diferença: ${currency(resultado.diferenca_centavos)}`)
      await onRefresh()
    } catch (erro) {
      onError(erro)
    }
  }

  return (
    <Modal titulo="Fechar caixa" onFechar={onFechar} largura={480}>
      <form onSubmit={fechar}>
        <p className="pdv-explica">
          Esperado em dinheiro na gaveta: <strong>{currency(cash.saldo_esperado_centavos)}</strong>
        </p>
        <label className="pdv-campo">
          Valor contado na gaveta
          <input autoFocus inputMode="decimal" value={contado} onChange={(evento) => setContado(evento.target.value)} placeholder="R$ 0,00" required />
        </label>
        <button type="submit" className="pdv-concluir">Fechar caixa</button>
      </form>
    </Modal>
  )
}

function MovimentacaoCaixaModal({ tipo, onFechar, onRefresh, onError, onSuccess }) {
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const sangria = tipo === 'SANGRIA'

  async function registrar(evento) {
    evento.preventDefault()
    const valorCentavos = decimalToCents(valor)
    if (!Number.isSafeInteger(valorCentavos) || valorCentavos <= 0) {
      onError(new Error('Informe um valor maior que zero.'))
      return
    }
    if (!motivo.trim()) {
      onError(new Error('Informe o motivo da movimentação.'))
      return
    }

    setSalvando(true)
    try {
      await api('/caixa/movimentacoes', {
        method: 'POST',
        body: JSON.stringify({ tipo, valor_centavos: valorCentavos, motivo }),
      })
      onSuccess(sangria ? 'Sangria registrada.' : 'Suprimento registrado.')
      onFechar()
      await onRefresh()
    } catch (erro) {
      onError(erro)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo={`Registrar ${sangria ? 'sangria' : 'suprimento'}`} onFechar={() => { if (!salvando) onFechar() }} largura={480}>
      <form onSubmit={registrar}>
        <p className="pdv-explica">
          {sangria
            ? 'O valor será retirado do saldo esperado em dinheiro do caixa.'
            : 'O valor será somado ao saldo esperado em dinheiro do caixa.'}
        </p>
        <label className="pdv-campo">
          Valor (R$)
          <input autoFocus inputMode="decimal" value={valor} onChange={(evento) => setValor(evento.target.value)} placeholder="0,00" required />
        </label>
        <label className="pdv-campo">
          Motivo
          <input value={motivo} onChange={(evento) => setMotivo(evento.target.value)} maxLength={500} placeholder={sangria ? 'Ex.: retirada para o cofre' : 'Ex.: reforço de troco'} required />
        </label>
        <button type="submit" className="pdv-concluir" disabled={salvando}>{salvando ? 'Registrando...' : `Confirmar ${sangria ? 'sangria' : 'suprimento'}`}</button>
      </form>
    </Modal>
  )
}
