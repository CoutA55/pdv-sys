const { ErroDeRequisicao } = require('./erros');

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 24 * 60 * 60 * 1000;
const MAX_DIAS = 1100; // cerca de 3 anos

// Datas do relatório são tratadas como dia civil (AAAA-MM-DD), sempre em UTC
// só para fazer contas de calendário sem surpresa com fuso e horário de verão.
function dataUtc(valor, campo) {
  const texto = String(valor);
  if (!FORMATO_DATA.test(texto)) {
    throw new ErroDeRequisicao(400, `${campo} deve estar no formato AAAA-MM-DD.`);
  }
  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
    throw new ErroDeRequisicao(400, `${campo} não é uma data válida.`);
  }
  return data;
}

const paraIso = (data) => data.toISOString().slice(0, 10);
const somarDias = (data, dias) => new Date(data.getTime() + dias * DIA_MS);

function hojeLocalIso() {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

function resolverPeriodo(query) {
  const hoje = hojeLocalIso();
  const de = dataUtc(query.de ?? `${hoje.slice(0, 8)}01`, 'de');
  const ate = dataUtc(query.ate ?? hoje, 'ate');

  if (de > ate) {
    throw new ErroDeRequisicao(400, 'A data inicial não pode ser depois da data final.');
  }
  const dias = Math.round((ate - de) / DIA_MS) + 1;
  if (dias > MAX_DIAS) {
    throw new ErroDeRequisicao(400, 'Período muito longo: escolha no máximo 3 anos.');
  }

  let agrupar = query.agrupar;
  if (agrupar === undefined) agrupar = dias > 62 ? 'mes' : 'dia';
  if (agrupar !== 'dia' && agrupar !== 'mes') {
    throw new ErroDeRequisicao(400, 'agrupar deve ser "dia" ou "mes".');
  }

  // Período anterior, com o mesmo número de dias, logo antes deste.
  const anteriorAte = somarDias(de, -1);
  const anteriorDe = somarDias(anteriorAte, -(dias - 1));

  return { de, ate, dias, agrupar, anteriorDe, anteriorAte };
}

// Todas as chaves do período (para os dias/meses sem venda aparecerem com zero).
function chavesDoPeriodo(de, ate, agrupar) {
  const chaves = [];
  if (agrupar === 'dia') {
    for (let dia = de; dia <= ate; dia = somarDias(dia, 1)) chaves.push(paraIso(dia));
    return chaves;
  }
  let ano = de.getUTCFullYear();
  let mes = de.getUTCMonth();
  const fim = ate.getUTCFullYear() * 12 + ate.getUTCMonth();
  while (ano * 12 + mes <= fim) {
    chaves.push(`${ano}-${String(mes + 1).padStart(2, '0')}`);
    mes += 1;
    if (mes === 12) {
      mes = 0;
      ano += 1;
    }
  }
  return chaves;
}

// As vendas guardam a hora em UTC. 'localtime' converte para o fuso do computador
// da loja, para que uma venda das 23h30 conte no dia certo.
const DIA_LOCAL = "date(v.criado_em, 'localtime')";

function gerarRelatorio(db, query = {}) {
  const periodo = resolverPeriodo(query);
  const de = paraIso(periodo.de);
  const ate = paraIso(periodo.ate);

  const resumoEntre = (inicio, fim) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(v.total_centavos), 0)    AS faturamento_centavos,
                COUNT(*)                              AS vendas,
                COALESCE(SUM(v.desconto_centavos), 0) AS descontos_centavos
           FROM vendas v
          WHERE v.status = 'CONCLUIDA' AND ${DIA_LOCAL} BETWEEN ? AND ?`
      )
      .get(inicio, fim);

  const atual = resumoEntre(de, ate);
  const anterior = resumoEntre(paraIso(periodo.anteriorDe), paraIso(periodo.anteriorAte));

  const canceladas = db
    .prepare(
      `SELECT COUNT(*) AS quantidade, COALESCE(SUM(v.total_centavos), 0) AS total_centavos
         FROM vendas v
        WHERE v.status = 'CANCELADA' AND ${DIA_LOCAL} BETWEEN ? AND ?`
    )
    .get(de, ate);

  // O formato vem de uma lista fixa (dia ou mes), nunca direto do cliente.
  const formato = periodo.agrupar === 'mes' ? '%Y-%m' : '%Y-%m-%d';
  const linhas = db
    .prepare(
      `SELECT strftime('${formato}', v.criado_em, 'localtime') AS periodo,
              SUM(v.total_centavos) AS faturamento_centavos,
              COUNT(*)              AS vendas
         FROM vendas v
        WHERE v.status = 'CONCLUIDA' AND ${DIA_LOCAL} BETWEEN ? AND ?
        GROUP BY periodo`
    )
    .all(de, ate);
  const porPeriodo = new Map(linhas.map((linha) => [linha.periodo, linha]));
  const serie = chavesDoPeriodo(periodo.de, periodo.ate, periodo.agrupar).map((chave) => ({
    periodo: chave,
    faturamento_centavos: porPeriodo.get(chave)?.faturamento_centavos ?? 0,
    vendas: porPeriodo.get(chave)?.vendas ?? 0,
  }));

  const porForma = db
    .prepare(
      `SELECT p.forma,
              SUM(p.valor_centavos)      AS valor_centavos,
              COUNT(DISTINCT p.venda_id) AS vendas
         FROM pagamentos p
         JOIN vendas v ON v.id = p.venda_id
        WHERE v.status = 'CONCLUIDA' AND ${DIA_LOCAL} BETWEEN ? AND ?
        GROUP BY p.forma
        ORDER BY valor_centavos DESC`
    )
    .all(de, ate);

  const topProdutos = db
    .prepare(
      `SELECT i.produto_id,
              MIN(i.descricao)              AS nome,
              MIN(pr.unidade)               AS unidade,
              SUM(i.quantidade_milesimos)   AS quantidade_milesimos,
              SUM(i.total_centavos)         AS total_centavos
         FROM venda_itens i
         JOIN vendas v    ON v.id = i.venda_id
         JOIN produtos pr ON pr.id = i.produto_id
        WHERE v.status = 'CONCLUIDA' AND ${DIA_LOCAL} BETWEEN ? AND ?
        GROUP BY i.produto_id
        ORDER BY total_centavos DESC
        LIMIT 10`
    )
    .all(de, ate);

  return {
    periodo: { de, ate, dias: periodo.dias, agrupar: periodo.agrupar },
    resumo: {
      faturamento_centavos: atual.faturamento_centavos,
      vendas: atual.vendas,
      ticket_medio_centavos: atual.vendas ? Math.round(atual.faturamento_centavos / atual.vendas) : 0,
      descontos_centavos: atual.descontos_centavos,
      canceladas: canceladas.quantidade,
      canceladas_centavos: canceladas.total_centavos,
    },
    anterior: {
      de: paraIso(periodo.anteriorDe),
      ate: paraIso(periodo.anteriorAte),
      faturamento_centavos: anterior.faturamento_centavos,
      vendas: anterior.vendas,
    },
    serie,
    por_forma: porForma,
    top_produtos: topProdutos,
  };
}

module.exports = { gerarRelatorio, chavesDoPeriodo, resolverPeriodo, dataUtc };
