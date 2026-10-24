import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { api, currency, dataIso, decimalToCents, qtyLabel, toMilesimos } from './lib.js'
import { Metric, PageHeading } from './components.jsx'
import CashRegister from './pages/CashRegister.jsx'
import Relatorios from './pages/Relatorios.jsx'
import Backup from './pages/Backup.jsx'

const NAV = [
  { id: 'inicio', label: 'Visão geral', icon: 'inicio' },
  { id: 'caixa', label: 'Caixa', icon: 'caixa' },
  { id: 'estoque', label: 'Estoque', icon: 'estoque' },
  { id: 'relatorios', label: 'Relatórios', icon: 'relatorios' },
  { id: 'backup', label: 'Backup', icon: 'backup' },
]
const ICONES = {
  inicio: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
  caixa: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 10h18M7 15h3m4 0h3" /><path d="M7 3v2m10-2v2" /></>,
  estoque: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 8 9 5 9-5M3 8v9l9 5 9-5V8M12 13v9" /></>,
  relatorios: <><path d="M4 20V10m5 10V4m6 16v-7m5 7V7" /><path d="M2 20h20" /></>,
  backup: <><path d="M4 4h13l3 3v13H4z" /><path d="M8 4v6h8V4M8 20v-6h8v6" /></>,
  recolher: <path d="m15 18-6-6 6-6" />,
  expandir: <path d="m9 18 6-6-6-6" />,
  ir: <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>,
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
  lua: <path d="M20.8 13A8.5 8.5 0 0 1 11 3.2 8.5 8.5 0 1 0 20.8 13Z" />,
  atualizar: <><path d="M20 7v5h-5" /><path d="M4.8 9A7.5 7.5 0 0 1 18 6l2 6M4 17v-5h5" /><path d="M19.2 15A7.5 7.5 0 0 1 6 18l-2-6" /></>,
  dinheiro: <><circle cx="12" cy="12" r="9" /><path d="M15 9.5c-.6-.7-1.5-1-2.8-1-1.5 0-2.5.7-2.5 1.8 0 2.9 5.6 1.1 5.6 4.2 0 1.2-1.1 2-2.8 2-1.2 0-2.3-.4-3-1.2M12 7v10" /></>,
  reposicao: <><path d="M12 3v18m-5-4.5c.7 1 1.8 1.5 3.5 1.5 2.2 0 3.5-1 3.5-2.5 0-3.8-7-1.5-7-5.5C7 8.5 8.5 7 11 7c1.4 0 2.6.5 3.5 1.5" /></>,
  lucro: <><path d="M4 19V5m0 14h16" /><path d="m7 15 4-4 3 2 5-6" /><path d="M15 7h4v4" /></>,
  produto: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="M3 8v9l9 5 9-5V8" /><path d="M12 13v9" /></>,
  alerta: <><path d="M10.3 4.3 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 3h.01" /></>,
  categoria: <><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" /></>,
  unidade: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="M3 8v9l9 5 9-5V8" /><path d="M12 13v9" /></>,
  busca: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
  adicionar: <><path d="M12 5v14m-7-7h14" /></>,
  entrada: <><path d="M12 21V9m-5 5 5-5 5 5M5 5h14" /></>,
  ajuste: <><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M2 14h4m4-6h4m4 8h4" /></>,
  historico: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5m4-1v5l3 2" /></>,
  editar: <><path d="m15 5 4 4M4 20l4-.8L19 8a2.8 2.8 0 0 0-4-4L4 15l0 5Z" /></>,
}
function InterfaceIcon({ name, className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONES[name]}
    </svg>
  )
}
const saudacao = () => {
  const hora = new Date().getHours()
  return hora < 12 ? 'Bom dia!' : hora < 18 ? 'Boa tarde!' : 'Boa noite!'
}
const TODAY = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date())

function App() {
  const [page, setPage] = useState('inicio')
  const [products, setProducts] = useState([])
  const [stockSummary, setStockSummary] = useState(null)
  const [categories, setCategories] = useState([])
  const [operators, setOperators] = useState([])
  const [cash, setCash] = useState(null)
  const [creditReport, setCreditReport] = useState(null)
  const [todaySales, setTodaySales] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [menuRecolhido, setMenuRecolhido] = useState(false)
  const [temaEscuro, setTemaEscuro] = useState(() => localStorage.getItem('pdv-tema') === 'escuro')

  useEffect(() => {
    localStorage.setItem('pdv-tema', temaEscuro ? 'escuro' : 'claro')
  }, [temaEscuro])

  const loadData = useCallback(async () => {
    try {
      const hoje = dataIso(new Date())
      const [productList, categoryList, operatorList, cashState, report, salesToday, summary] = await Promise.all([
        api('/produtos?limite=200'),
        api('/categorias'),
        api('/usuarios'),
        api('/caixa/aberto'),
        api('/relatorios/fiado'),
        api(`/relatorios/faturamento?de=${hoje}&ate=${hoje}`),
        api('/estoque/resumo'),
      ])
      setProducts(productList)
      setStockSummary(summary)
      setCategories(categoryList)
      setOperators(operatorList)
      setCash(cashState.sessao)
      setCreditReport(report)
      setTodaySales(salesToday)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(loadData, 0)
    return () => window.clearTimeout(timeout)
  }, [loadData])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const lowStock = useMemo(
    () => products.filter((product) => product.estoque_milesimos <= product.estoque_minimo_milesimos),
    [products],
  )

  const handleError = (requestError) => setError(requestError.message)
  const handleSuccess = (message) => {
    setError('')
    setNotice(message)
  }

  return (
    <div className={`app-shell${menuRecolhido ? ' menu-recolhido' : ''}`} data-theme={temaEscuro ? 'escuro' : 'claro'}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-mark">M</div>
            <div>
              <strong>Mercadinho</strong>
              <span>PDV LOCAL</span>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setMenuRecolhido((recolhido) => !recolhido)}
            aria-label={menuRecolhido ? 'Expandir menu' : 'Minimizar menu'}
            title={menuRecolhido ? 'Expandir menu' : 'Minimizar menu'}
          >
            <InterfaceIcon name={menuRecolhido ? 'expandir' : 'recolher'} />
          </button>
        </div>
        <div className="store-badge"><span className="status-dot" /><span>Loja funcionando</span></div>
        <div className="nav-caption">MENU PRINCIPAL</div>
        <nav className="main-nav" aria-label="Menu principal">
          {NAV.map((item) => (
            <button
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              key={item.id}
              aria-label={item.label}
              title={item.label}
              onClick={() => { setPage(item.id); setError('') }}
            >
              <span className="nav-icon"><InterfaceIcon name={item.icon} /></span>
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="nav-item theme-toggle"
            aria-label={temaEscuro ? 'Ativar modo claro' : 'Ativar modo escuro'}
            aria-pressed={temaEscuro}
            title={temaEscuro ? 'Ativar modo claro' : 'Ativar modo escuro'}
            onClick={() => setTemaEscuro((escuro) => !escuro)}
          >
            <span className="nav-icon"><InterfaceIcon name={temaEscuro ? 'sol' : 'lua'} /></span>
            <span>{temaEscuro ? 'Modo claro' : 'Modo escuro'}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status"><span className="status-dot" /> Operação local</div>
          <span>Seus dados ficam neste computador.</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Mercadinho <span>/</span> {NAV.find((item) => item.id === page)?.label}</div>
          <div className="topbar-right">
            <span className="today">{TODAY}</span>
            <button className="icon-button" title="Atualizar dados" aria-label="Atualizar dados" onClick={loadData}><InterfaceIcon name="atualizar" /></button>
            <div className="avatar">M</div>
          </div>
        </header>

        {error && <div className="alert error-alert" role="alert"><span>!</span>{error}<button onClick={() => setError('')}>×</button></div>}
        {loading && <div className="loading-bar"><span /></div>}

        {page === 'inicio' && (
          <Dashboard
            stockSummary={stockSummary}
            cash={cash}
            lowStock={lowStock}
            creditReport={creditReport}
            todaySales={todaySales}
            onNavigate={setPage}
            onRefresh={loadData}
          />
        )}
        {page === 'caixa' && (
          <CashRegister
            cash={cash}
            operators={operators}
            onRefresh={loadData}
            onError={handleError}
            onSuccess={handleSuccess}
          />
        )}
        {page === 'estoque' && (
          <Inventory
            products={products}
            stockSummary={stockSummary}
            categories={categories}
            onRefresh={loadData}
            onError={handleError}
            onSuccess={handleSuccess}
          />
        )}
        {page === 'relatorios' && <Relatorios fiado={creditReport} caixaAberto={Boolean(cash)} onRefresh={loadData} />}
        {page === 'backup' && <Backup />}

        {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}
      </main>
    </div>
  )
}

function Dashboard({ stockSummary, cash, lowStock, creditReport, todaySales, onNavigate, onRefresh }) {
  return (
    <div className="page-wrap">
      <PageHeading
        eyebrow="RESUMO DA LOJA"
        title={saudacao()}
        description="Aqui está um resumo da operação do seu mercadinho."
        action={<button className="button button-secondary" onClick={onRefresh}><InterfaceIcon name="atualizar" />Atualizar</button>}
      />
      <div className="welcome-banner">
        <div>
          <span className="banner-label">PAINEL DO MERCADINHO</span>
          <h2>O dia começa por aqui.</h2>
          <p>Acompanhe o caixa, o estoque e o que ainda falta receber.</p>
        </div>
        <div className="banner-art" aria-hidden="true">✳</div>
      </div>
      <div className="metric-grid">
        <Metric icon={<InterfaceIcon name="caixa" />} tone="blue" label="CAIXA" value={cash ? 'Aberto' : 'Fechado'} helper={cash ? currency(cash.saldo_esperado_centavos) + ' esperado' : 'Pronto para abrir'} />
        <Metric icon={<InterfaceIcon name="dinheiro" />} tone="green" label="FATURAMENTO HOJE" value={todaySales ? currency(todaySales.resumo.faturamento_centavos) : '—'} helper={todaySales ? `${todaySales.resumo.vendas} ${todaySales.resumo.vendas === 1 ? 'venda' : 'vendas'} hoje` : 'Atualize o servidor para ver'} />
        <Metric icon={<InterfaceIcon name="produto" />} tone="orange" label="ESTOQUE BAIXO" value={stockSummary?.produtos_baixo_estoque ?? lowStock.length} helper="Produtos para conferir" />
        <Metric icon={<InterfaceIcon name="dinheiro" />} tone="purple" label="A RECEBER" value={currency(creditReport?.resumo.total_a_receber_centavos)} helper={`${creditReport?.resumo.clientes_devedores ?? 0} clientes com saldo`} />
      </div>
      <div className="metric-grid stock-value-grid">
        <Metric icon={<InterfaceIcon name="produto" />} tone="blue" label="ESTOQUE A CUSTO" value={currency(stockSummary?.valor_estoque_custo_centavos)} helper="Estimado pelo custo cadastrado" />
        <Metric icon={<InterfaceIcon name="dinheiro" />} tone="green" label="FATURAMENTO POTENCIAL" value={currency(stockSummary?.faturamento_potencial_centavos)} helper="Se todo o estoque for vendido" />
        <Metric icon={<InterfaceIcon name="lucro" />} tone="purple" label="LUCRO BRUTO POTENCIAL" value={currency(stockSummary?.lucro_bruto_potencial_centavos)} helper={`Margem estimada: ${stockSummary?.margem_bruta_potencial_percentual ?? 0}%`} />
      </div>
      <div className="dashboard-columns">
        <section className="panel shortcuts-panel">
          <div className="section-title">
            <div><div className="eyebrow">ATALHOS</div><h2>O que você vai fazer?</h2></div>
          </div>
          <div className="shortcut-grid">
            <button className="shortcut-card shortcut-blue" onClick={() => onNavigate('caixa')}>
              <span className="shortcut-symbol"><InterfaceIcon name="caixa" /></span><strong>Frente de caixa</strong><small>Registrar uma venda</small><span className="shortcut-arrow"><InterfaceIcon name="ir" /></span>
            </button>
            <button className="shortcut-card shortcut-green" onClick={() => onNavigate('estoque')}>
              <span className="shortcut-symbol"><InterfaceIcon name="estoque" /></span><strong>Estoque</strong><small>Produtos e reposição</small><span className="shortcut-arrow"><InterfaceIcon name="ir" /></span>
            </button>
            <button className="shortcut-card shortcut-lilac" onClick={() => onNavigate('relatorios')}>
              <span className="shortcut-symbol"><InterfaceIcon name="relatorios" /></span><strong>Relatórios</strong><small>Faturamento e fiado</small><span className="shortcut-arrow"><InterfaceIcon name="ir" /></span>
            </button>
          </div>
        </section>
        <section className="panel stock-panel">
          <div className="section-title">
            <div><div className="eyebrow">ATENÇÃO</div><h2>Estoque para conferir</h2></div>
            <button className="text-button" onClick={() => onNavigate('estoque')}>Ver estoque →</button>
          </div>
          {lowStock.length === 0 ? (
            <div className="empty-state compact-empty"><span className="empty-icon">✓</span><strong>Tudo em ordem</strong><small>Nenhum produto abaixo do mínimo.</small></div>
          ) : lowStock.slice(0, 4).map((product) => (
            <div className="stock-row" key={product.id}>
              <div className="product-avatar">{product.nome.slice(0, 1).toUpperCase()}</div>
              <div className="stock-row-name"><strong>{product.nome}</strong><small>{qtyLabel(product.estoque_milesimos, product.unidade)} em estoque</small></div>
              <span className="tag tag-warning">Baixo</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

function Inventory({ products, categories, stockSummary, onRefresh, onError, onSuccess }) {
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [entryProduct, setEntryProduct] = useState(null)
  const [adjustProduct, setAdjustProduct] = useState(null)
  const [adjustForm, setAdjustForm] = useState({ saldoContado: '', observacao: '' })
  const [historyProduct, setHistoryProduct] = useState(null)
  const [movements, setMovements] = useState([])
  const [loadingMovements, setLoadingMovements] = useState(false)
  const [movementError, setMovementError] = useState('')
  const [entryForm, setEntryForm] = useState({ quantidade: '', custo: '', observacao: '', atualizarCusto: false })
  const [form, setForm] = useState({ nome: '', codigo_barras: '', unidade: 'UN', categoria_id: '', preco_venda: '', preco_custo: '', estoque: '', minimo: '' })

  const visibleProducts = products.filter((product) =>
    `${product.nome} ${product.codigo_barras || ''}`.toLowerCase().includes(query.toLowerCase()),
  )

  function openCreateForm() {
    setEditingProduct(null)
    setForm({ nome: '', codigo_barras: '', unidade: 'UN', categoria_id: '', preco_venda: '', preco_custo: '', estoque: '', minimo: '' })
    setShowForm(true)
  }

  function openEditForm(product) {
    setEditingProduct(product)
    setForm({
      nome: product.nome,
      codigo_barras: product.codigo_barras || '',
      unidade: product.unidade,
      categoria_id: product.categoria_id || '',
      preco_venda: String(product.preco_venda_centavos / 100).replace('.', ','),
      preco_custo: String(product.preco_custo_centavos / 100).replace('.', ','),
      estoque: '',
      minimo: String(product.estoque_minimo_milesimos / 1000).replace('.', ','),
    })
    setShowForm(true)
  }

  function openEntryForm(product) {
    setEntryProduct(product)
    setEntryForm({
      quantidade: '',
      custo: String(product.preco_custo_centavos / 100).replace('.', ','),
      observacao: '',
      atualizarCusto: false,
    })
  }

  async function registerEntry(event) {
    event.preventDefault()
    try {
      const quantidade = toMilesimos(entryForm.quantidade)
      const custo = entryForm.custo.trim() ? decimalToCents(entryForm.custo) : undefined
      if (!Number.isSafeInteger(quantidade) || quantidade <= 0) {
        throw new Error('Informe uma quantidade maior que zero.')
      }
      if (entryProduct.unidade === 'UN' && quantidade % 1000 !== 0) {
        throw new Error('Para produtos por unidade, informe uma quantidade inteira.')
      }
      if (custo !== undefined && (!Number.isSafeInteger(custo) || custo < 0)) {
        throw new Error('Informe um custo unitário válido.')
      }
      if (entryForm.atualizarCusto && custo === undefined) {
        throw new Error('Informe o custo para atualizar o cadastro do produto.')
      }

      await api('/estoque/entrada', {
        method: 'POST',
        body: JSON.stringify({
          produto_id: entryProduct.id,
          quantidade_milesimos: quantidade,
          ...(custo === undefined ? {} : { custo_unitario_centavos: custo }),
          observacao: entryForm.observacao,
          atualizar_custo_produto: entryForm.atualizarCusto,
        }),
      })
      setEntryProduct(null)
      onSuccess(`Entrada registrada: ${entryForm.quantidade} ${entryProduct.unidade} de ${entryProduct.nome}.`)
      await onRefresh()
    } catch (requestError) {
      onError(requestError)
    }
  }

  async function registerAdjustment(event) {
    event.preventDefault()
    try {
      const saldoContado = toMilesimos(adjustForm.saldoContado)
      if (!Number.isSafeInteger(saldoContado) || saldoContado < 0) {
        throw new Error('Informe uma contagem física válida.')
      }
      if (adjustProduct.unidade === 'UN' && saldoContado % 1000 !== 0) {
        throw new Error('Para produtos por unidade, informe uma contagem inteira.')
      }
      if (!adjustForm.observacao.trim()) throw new Error('Informe o motivo do ajuste.')

      const resultado = await api('/estoque/ajuste', {
        method: 'POST',
        body: JSON.stringify({
          produto_id: adjustProduct.id,
          saldo_contado_milesimos: saldoContado,
          observacao: adjustForm.observacao,
        }),
      })
      setAdjustProduct(null)
      onSuccess(`Ajuste registrado: estoque atualizado para ${qtyLabel(resultado.estoque_milesimos, adjustProduct.unidade)}.`)
      await onRefresh()
    } catch (requestError) {
      onError(requestError)
    }
  }

  async function openMovementHistory(product) {
    setHistoryProduct(product)
    setMovements([])
    setMovementError('')
    setLoadingMovements(true)
    try {
      const resultado = await api(`/estoque/movimentacoes?produto_id=${encodeURIComponent(product.id)}&limite=100`)
      setMovements(resultado)
    } catch (requestError) {
      setMovementError(requestError.message)
    } finally {
      setLoadingMovements(false)
    }
  }

  async function saveProduct(event) {
    event.preventDefault()
    try {
      const data = {
        nome: form.nome,
        codigo_barras: form.codigo_barras || null,
        categoria_id: form.categoria_id || null,
        preco_venda_centavos: decimalToCents(form.preco_venda),
        preco_custo_centavos: decimalToCents(form.preco_custo || '0'),
        estoque_minimo_milesimos: toMilesimos(form.minimo || '0'),
      }
      if (!Number.isSafeInteger(data.preco_venda_centavos) || data.preco_venda_centavos < 0) {
        throw new Error('Informe um preço de venda válido.')
      }
      if (!Number.isSafeInteger(data.preco_custo_centavos) || data.preco_custo_centavos < 0) {
        throw new Error('Informe um custo de compra válido.')
      }
      if (!Number.isSafeInteger(data.estoque_minimo_milesimos) || data.estoque_minimo_milesimos < 0) {
        throw new Error('Informe um estoque mínimo válido.')
      }
      if (editingProduct) {
        await api(`/produtos/${encodeURIComponent(editingProduct.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        })
      } else {
        const estoqueInicial = toMilesimos(form.estoque || '0')
        if (!Number.isSafeInteger(estoqueInicial) || estoqueInicial < 0) {
          throw new Error('Informe um estoque inicial válido.')
        }
        await api('/produtos', {
          method: 'POST',
          body: JSON.stringify({ ...data, unidade: form.unidade, estoque_inicial_milesimos: estoqueInicial }),
        })
      }
      setShowForm(false)
      onSuccess(editingProduct ? 'Produto atualizado.' : 'Produto cadastrado.')
      setEditingProduct(null)
      await onRefresh()
    } catch (requestError) {
      onError(requestError)
    }
  }

  return (
    <div className="page-wrap">
      <PageHeading
        eyebrow="ESTOQUE"
        title="Produtos"
        description="Cadastre produtos, consulte preços e acompanhe o estoque."
        action={<button className="button button-primary" onClick={openCreateForm}><InterfaceIcon name="adicionar" />Novo produto</button>}
      />
      <div className="metric-grid inventory-metrics">
        <Metric icon={<InterfaceIcon name="produto" />} tone="green" label="PRODUTOS ATIVOS" value={stockSummary?.produtos_ativos ?? products.length} helper="Itens cadastrados" />
        <Metric icon={<InterfaceIcon name="alerta" />} tone="orange" label="ESTOQUE BAIXO" value={stockSummary?.produtos_baixo_estoque ?? products.filter((product) => product.estoque_milesimos <= product.estoque_minimo_milesimos).length} helper="No mínimo ou abaixo" />
        <Metric icon={<InterfaceIcon name="categoria" />} tone="blue" label="CATEGORIAS" value={categories.length} helper="Categorias disponíveis" />
        <Metric icon={<InterfaceIcon name="unidade" />} tone="purple" label="UNIDADES" value={stockSummary?.unidades_produto ?? new Set(products.map((product) => product.unidade)).size} helper="UN, KG ou L" />
      </div>
      <div className="metric-grid stock-value-grid">
        <Metric icon={<InterfaceIcon name="produto" />} tone="blue" label="ESTOQUE A CUSTO" value={currency(stockSummary?.valor_estoque_custo_centavos)} helper="Pelo custo cadastrado" />
        <Metric icon={<InterfaceIcon name="dinheiro" />} tone="green" label="FATURAMENTO POTENCIAL" value={currency(stockSummary?.faturamento_potencial_centavos)} helper="Vendendo o estoque atual" />
        <Metric icon={<InterfaceIcon name="lucro" />} tone="purple" label="LUCRO BRUTO POTENCIAL" value={currency(stockSummary?.lucro_bruto_potencial_centavos)} helper={`Margem estimada: ${stockSummary?.margem_bruta_potencial_percentual ?? 0}%`} />
      </div>
      <p className="inventory-estimate-note">Estimativa com os custos e preços cadastrados. Não desconta despesas, impostos ou perdas futuras.</p>
      <section className="panel inventory-panel">
        <div className="inventory-toolbar">
          <label className="search-input"><InterfaceIcon name="busca" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por produto ou código de barras..." /></label>
          <span className="result-count">{visibleProducts.length} produtos</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>PRODUTO</th><th>CÓDIGO DE BARRAS</th><th>ESTOQUE</th><th>PREÇO DE VENDA</th><th>STATUS</th><th>AÇÕES</th></tr></thead>
            <tbody>
              {visibleProducts.map((product) => {
                const baixo = product.estoque_milesimos <= product.estoque_minimo_milesimos
                return (
                  <tr key={product.id}>
                    <td><div className="table-product"><div className="product-avatar">{product.nome.slice(0, 1).toUpperCase()}</div><div><strong>{product.nome}</strong><small>{product.unidade}{product.categoria_id && ` · ${categories.find((category) => category.id === product.categoria_id)?.nome || 'Categoria'}`}</small></div></div></td>
                    <td className="muted-cell">{product.codigo_barras || '—'}</td>
                    <td><strong>{qtyLabel(product.estoque_milesimos, product.unidade)}</strong></td>
                    <td><strong>{currency(product.preco_venda_centavos)}</strong></td>
                    <td><span className={`tag ${baixo ? 'tag-warning' : 'tag-good'}`}>{baixo ? 'Estoque baixo' : 'Disponível'}</span></td>
                    <td>
                      <div className="product-actions">
                        <button type="button" className="text-button" onClick={() => openEntryForm(product)}><InterfaceIcon name="entrada" />Entrada</button>
                        <button type="button" className="text-button" onClick={() => { setAdjustProduct(product); setAdjustForm({ saldoContado: String(product.estoque_milesimos / 1000).replace('.', ','), observacao: '' }) }}><InterfaceIcon name="ajuste" />Ajustar</button>
                        <button type="button" className="text-button" onClick={() => openMovementHistory(product)}><InterfaceIcon name="historico" />Histórico</button>
                        <button type="button" className="text-button" onClick={() => openEditForm(product)}><InterfaceIcon name="editar" />Editar</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!visibleProducts.length && <tr><td colSpan="6"><div className="empty-state compact-empty"><strong>Nenhum produto encontrado</strong><small>Cadastre um produto ou tente outra busca.</small></div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {showForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false) }}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
            <div className="modal-heading"><div><div className="eyebrow">CADASTRO DE ESTOQUE</div><h2 id="product-modal-title">{editingProduct ? 'Editar produto' : 'Novo produto'}</h2></div><button className="icon-button" onClick={() => setShowForm(false)} aria-label="Fechar">×</button></div>
            <form className="product-form" onSubmit={saveProduct}>
              <label className="field-wide">Nome do produto<input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} required autoFocus placeholder="Ex.: Arroz tipo 1" /></label>
              <label>Código de barras<input value={form.codigo_barras} onChange={(event) => setForm({ ...form, codigo_barras: event.target.value })} placeholder="Opcional" /></label>
              <label>Categoria<select value={form.categoria_id} onChange={(event) => setForm({ ...form, categoria_id: event.target.value })}><option value="">Sem categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.nome}</option>)}</select></label>
              <label>Unidade<select value={form.unidade} disabled={Boolean(editingProduct)} onChange={(event) => setForm({ ...form, unidade: event.target.value })}><option value="UN">Unidade (UN)</option><option value="KG">Quilo (KG)</option><option value="L">Litro (L)</option></select></label>
              <label>Preço de venda (R$)<input inputMode="decimal" value={form.preco_venda} onChange={(event) => setForm({ ...form, preco_venda: event.target.value })} placeholder="0,00" required /></label>
              <label>Custo de compra (R$)<input inputMode="decimal" value={form.preco_custo} onChange={(event) => setForm({ ...form, preco_custo: event.target.value })} placeholder="0,00" /></label>
              {editingProduct
                ? <p className="field-wide">Para preservar o histórico, a unidade não pode ser alterada aqui. Use as movimentações de estoque para ajustar quantidades.</p>
                : <label>Estoque inicial<input inputMode="decimal" value={form.estoque} onChange={(event) => setForm({ ...form, estoque: event.target.value })} placeholder="0" /></label>}
              <label>Alerta de estoque mínimo<input inputMode="decimal" value={form.minimo} onChange={(event) => setForm({ ...form, minimo: event.target.value })} placeholder="0" /></label>
              <div className="modal-actions field-wide"><button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancelar</button><button className="button button-primary">{editingProduct ? 'Salvar alterações' : 'Salvar produto'}</button></div>
            </form>
          </section>
        </div>
      )}

      {entryProduct && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEntryProduct(null) }}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="entry-modal-title">
            <div className="modal-heading">
              <div><div className="eyebrow">MOVIMENTAÇÃO DE ESTOQUE</div><h2 id="entry-modal-title">Entrada de mercadoria</h2></div>
              <button className="icon-button" onClick={() => setEntryProduct(null)} aria-label="Fechar">×</button>
            </div>
            <p className="entry-product-name"><strong>{entryProduct.nome}</strong> · saldo atual: {qtyLabel(entryProduct.estoque_milesimos, entryProduct.unidade)}</p>
            <form className="product-form" onSubmit={registerEntry}>
              <label>Quantidade recebida ({entryProduct.unidade})
                <input autoFocus inputMode="decimal" value={entryForm.quantidade} onChange={(event) => setEntryForm({ ...entryForm, quantidade: event.target.value })} placeholder={entryProduct.unidade === 'UN' ? 'Ex.: 12' : 'Ex.: 2,500'} required />
              </label>
              <label>Custo por {entryProduct.unidade} (R$)
                <input inputMode="decimal" value={entryForm.custo} onChange={(event) => setEntryForm({ ...entryForm, custo: event.target.value })} placeholder="Opcional" />
              </label>
              <label className="field-wide">Observação (opcional)
                <input value={entryForm.observacao} onChange={(event) => setEntryForm({ ...entryForm, observacao: event.target.value })} placeholder="Ex.: compra do fornecedor" />
              </label>
              <label className="entry-checkbox field-wide">
                <input type="checkbox" checked={entryForm.atualizarCusto} onChange={(event) => setEntryForm({ ...entryForm, atualizarCusto: event.target.checked })} />
                Atualizar o custo cadastrado com o valor informado
              </label>
              <div className="modal-actions field-wide">
                <button type="button" className="button button-secondary" onClick={() => setEntryProduct(null)}>Cancelar</button>
                <button className="button button-primary">Registrar entrada</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {adjustProduct && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdjustProduct(null) }}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="adjust-modal-title">
            <div className="modal-heading">
              <div><div className="eyebrow">CONTAGEM DE ESTOQUE</div><h2 id="adjust-modal-title">Ajustar estoque</h2></div>
              <button className="icon-button" onClick={() => setAdjustProduct(null)} aria-label="Fechar">×</button>
            </div>
            <p className="entry-product-name"><strong>{adjustProduct.nome}</strong> · saldo registrado: {qtyLabel(adjustProduct.estoque_milesimos, adjustProduct.unidade)}</p>
            <form className="product-form" onSubmit={registerAdjustment}>
              <label>Contagem física ({adjustProduct.unidade})
                <input autoFocus inputMode="decimal" value={adjustForm.saldoContado} onChange={(event) => setAdjustForm({ ...adjustForm, saldoContado: event.target.value })} placeholder={adjustProduct.unidade === 'UN' ? 'Ex.: 12' : 'Ex.: 2,500'} required />
              </label>
              <label className="field-wide">Motivo do ajuste
                <input value={adjustForm.observacao} onChange={(event) => setAdjustForm({ ...adjustForm, observacao: event.target.value })} placeholder="Ex.: perda por validade ou contagem física" required />
              </label>
              <p className="field-wide">A diferença entre a contagem e o saldo será lançada no histórico. Este ajuste não altera lançamentos anteriores.</p>
              <div className="modal-actions field-wide">
                <button type="button" className="button button-secondary" onClick={() => setAdjustProduct(null)}>Cancelar</button>
                <button className="button button-primary">Registrar ajuste</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {historyProduct && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryProduct(null) }}>
          <section className="modal-card stock-history-modal" role="dialog" aria-modal="true" aria-labelledby="history-modal-title">
            <div className="modal-heading">
              <div><div className="eyebrow">LIVRO-RAZÃO DE ESTOQUE</div><h2 id="history-modal-title">Movimentações</h2></div>
              <button className="icon-button" onClick={() => setHistoryProduct(null)} aria-label="Fechar">×</button>
            </div>
            <p className="entry-product-name"><strong>{historyProduct.nome}</strong> · saldo atual: {qtyLabel(historyProduct.estoque_milesimos, historyProduct.unidade)}</p>
            {loadingMovements && <p className="rel-vazio">Carregando movimentações…</p>}
            {movementError && <p className="rel-aviso erro" role="alert">{movementError}</p>}
            {!loadingMovements && !movementError && movements.length === 0 && <p className="rel-vazio">Nenhuma movimentação registrada.</p>}
            {!loadingMovements && movements.length > 0 && (
              <div className="stock-history-list">
                {movements.map((movement) => {
                  const quantidade = movement.quantidade_milesimos
                  const nomeTipo = {
                    ENTRADA: 'Entrada',
                    SAIDA_VENDA: 'Venda',
                    ESTORNO_VENDA: 'Estorno de venda',
                    AJUSTE: 'Ajuste',
                  }[movement.tipo] || movement.tipo
                  return (
                    <article key={movement.id}>
                      <div>
                        <strong>{nomeTipo} · {qtyLabel(Math.abs(quantidade), movement.unidade)}</strong>
                        <small>{new Date(movement.criado_em).toLocaleString('pt-BR')} {movement.usuario_nome ? `· ${movement.usuario_nome}` : ''}</small>
                        {movement.observacao && <small>{movement.observacao}</small>}
                      </div>
                      <div>
                        {movement.custo_unitario_centavos !== null && <strong>{currency(movement.custo_unitario_centavos)} / {movement.unidade}</strong>}
                        <small>Saldo: {qtyLabel(movement.saldo_apos_milesimos, movement.unidade)}</small>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default App
