// Funções compartilhadas pelas telas.

export async function api(path, options) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: options?.body
      ? { 'content-type': 'application/json', ...options.headers }
      : options?.headers,
  })
  const data = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(data?.erro || 'Não foi possível concluir a operação.')
  return data
}

export const currency = (centavos = 0) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100)

// Converte o que a pessoa digitou em número.
//  - Dinheiro: "12,50", "12.50", "1.234,56" e "1234" funcionam.
//  - Com pontoDecimal (pesos): um único ponto é sempre decimal ("0.350" = 0,35).
export function parseNumero(valor, { pontoDecimal = false } = {}) {
  let texto = String(valor ?? '').trim().replace(/[^\d.,]/g, '')
  if (!/\d/.test(texto)) return NaN

  const virgulas = (texto.match(/,/g) || []).length
  const pontos = (texto.match(/\./g) || []).length

  if (virgulas > 0 && pontos > 0) {
    // O último separador é o decimal; o outro é separador de milhar.
    const decimal = texto.lastIndexOf(',') > texto.lastIndexOf('.') ? ',' : '.'
    const milhar = decimal === ',' ? '.' : ','
    texto = texto.split(milhar).join('').replace(decimal, '.')
  } else if (virgulas > 1) {
    texto = texto.replace(/,/g, '')
  } else if (virgulas === 1) {
    texto = texto.replace(',', '.')
  } else if (pontos > 1) {
    texto = texto.replace(/\./g, '')
  } else if (pontos === 1 && !pontoDecimal) {
    // "1.500" é mil e quinhentos; "12.50" é doze e cinquenta.
    if (texto.split('.')[1].length === 3) texto = texto.replace('.', '')
  }

  const numero = Number(texto)
  return Number.isFinite(numero) ? numero : NaN
}

export const decimalToCents = (valor) => {
  const numero = parseNumero(valor)
  return Number.isFinite(numero) ? Math.round(numero * 100) : NaN
}

export const toMilesimos = (valor) => {
  const numero = parseNumero(valor, { pontoDecimal: true })
  return Number.isFinite(numero) ? Math.round(numero * 1000) : NaN
}

export const milesimosToInput = (milesimos) => String(milesimos / 1000).replace('.', ',')

export const qtyLabel = (milesimos, unidade) => {
  const quantidade = (milesimos / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  return `${quantidade} ${unidade}`
}

// Data local no formato AAAA-MM-DD (a que o servidor espera).
export const dataIso = (data) =>
  `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`

// "2026-10-21" -> "21/10/2026"
export const dataBr = (iso) => iso.split('-').reverse().join('/')
