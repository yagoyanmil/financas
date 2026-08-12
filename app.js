import { firebaseConfig } from "./firebase-config.js";

"use strict";

// ---------------- constantes ----------------
const MONTH_NAMES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const PALETTE = ["#2f6feb","#e0463f","#f2a541","#1a9e6b","#8e5fd9","#e05a9e","#17a2b8","#6b7280","#c98a2c","#4361ee"];
const PEOPLE = ["Yago","Gabriela","Casa"];
const DEFAULT_CATEGORIES = {
  gasto: ["Moradia","Água","Luz","Internet","Contas de Casa","Mercado / Alimentação","Uber","Transporte","Saúde","Educação","Lazer","Restaurantes","Vestuário","Assinaturas / Streaming","Cuidados Pessoais","Presentes / Doações","Pets","Parcelas","Investimentos / Poupança","Dívidas / Empréstimos","Outros"],
  receita: ["Salário","Extra","Investimentos","Outros"]
};
const DEFAULT_PAYMENT_METHODS = ["Pix","Cartão de Crédito","Cartão de Débito","Dinheiro","Boleto","Transferência"];
const LOCAL_KEY = "controle-financeiro-casal:v2";
const HOUSEHOLD_KEY = "controle-financeiro-casal:household-id";
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.12.2";

const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const currency = (v) => (v < 0 ? "-" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const storageOk = (() => {
  try {
    localStorage.setItem("__cfp_test__", "1");
    localStorage.removeItem("__cfp_test__");
    return true;
  } catch (e) { return false; }
})();

// ---------------- estado ----------------
const state = {
  mode: "local", // 'local' | 'cloud'
  householdId: null,
  connection: "local", // local | connecting | synced | error
  household: { categorias: clone(DEFAULT_CATEGORIES), formasPagamento: [...DEFAULT_PAYMENT_METHODS] },
  entries: [],
  parcelamentos: [],
  renda: {}, // { "YYYY-MM": {yago,gabriela,casa} }
  currentType: "gasto",
  editingId: null,
  editingParcelaId: null,
  view: (() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; })(),
  annualYear: new Date().getFullYear()
};

// ================= LOCAL STORE =================
function localLoad() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.household) state.household = data.household;
    if (data.entries) state.entries = data.entries;
    if (data.parcelamentos) state.parcelamentos = data.parcelamentos;
    if (data.renda) state.renda = data.renda;
  } catch (e) {}
}
function localSave() {
  if (!storageOk) return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({
      household: state.household, entries: state.entries, parcelamentos: state.parcelamentos, renda: state.renda
    }));
  } catch (e) {}
}

// ================= CLOUD STORE (Firestore) =================
let db = null, auth = null, fsApi = null;

async function initCloud(householdId) {
  state.connection = "connecting";
  updateSaveStatus();
  try {
    const [{ initializeApp }, firestoreApi, authApi] = await Promise.all([
      import(`${FIREBASE_SDK}/firebase-app.js`),
      import(`${FIREBASE_SDK}/firebase-firestore.js`),
      import(`${FIREBASE_SDK}/firebase-auth.js`)
    ]);
    fsApi = firestoreApi;
    const app = initializeApp(firebaseConfig);
    db = fsApi.getFirestore(app);
    try { await fsApi.enableIndexedDbPersistence(db); } catch (e) { /* aba múltipla ou sem suporte: segue sem cache offline */ }
    auth = authApi.getAuth(app);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout de autenticação")), 12000);
      authApi.onAuthStateChanged(auth, (user) => { if (user) { clearTimeout(timeout); resolve(user); } });
      authApi.signInAnonymously(auth).catch((err) => { clearTimeout(timeout); reject(err); });
    });

    state.householdId = householdId;
    state.mode = "cloud";
    state.connection = "synced";
    subscribeCloud(householdId);
    updateSaveStatus();
  } catch (err) {
    console.error("Falha ao conectar ao Firebase, usando modo local:", err);
    state.mode = "local";
    state.connection = "error";
    if (storageOk) localLoad();
    $("storageBanner").style.display = "flex";
    $("storageBannerText").textContent = "Não foi possível conectar à sincronização agora — usando modo local só neste aparelho. Recarregue a página para tentar de novo.";
    refreshCategorySelect();
    refreshPaymentSelects();
    updateSaveStatus();
    renderAll();
  }
}

function subscribeCloud(householdId) {
  const hRef = fsApi.doc(db, "households", householdId);
  fsApi.setDoc(hRef, {
    categorias: state.household.categorias,
    formasPagamento: state.household.formasPagamento
  }, { merge: true }).catch(() => {});

  fsApi.onSnapshot(hRef, (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      if (d.categorias) state.household.categorias = d.categorias;
      if (d.formasPagamento) state.household.formasPagamento = d.formasPagamento;
      refreshCategorySelect();
      refreshPaymentSelects();
      renderAll();
    }
  }, (err) => console.error("household snapshot", err));

  fsApi.onSnapshot(fsApi.collection(db, "households", householdId, "entries"), (snap) => {
    state.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (err) => console.error("entries snapshot", err));

  fsApi.onSnapshot(fsApi.collection(db, "households", householdId, "parcelamentos"), (snap) => {
    state.parcelamentos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  }, (err) => console.error("parcelamentos snapshot", err));

  fsApi.onSnapshot(fsApi.collection(db, "households", householdId, "renda"), (snap) => {
    const r = {};
    snap.docs.forEach((d) => { r[d.id] = d.data(); });
    state.renda = r;
    renderAll();
  }, (err) => console.error("renda snapshot", err));
}

function updateSaveStatus() {
  const el = $("saveStatus");
  if (state.mode === "local" && !storageOk) { el.style.display = "none"; return; }
  el.style.display = "flex";
  const dot = el.querySelector(".dot");
  const text = $("saveStatusText");
  const badge = $("householdBadge");
  dot.classList.remove("connecting", "error");
  if (state.mode === "cloud") {
    if (state.connection === "synced") text.textContent = "Sincronizado em tempo real";
    else if (state.connection === "connecting") { dot.classList.add("connecting"); text.textContent = "Conectando..."; }
    else { dot.classList.add("error"); text.textContent = "Sem conexão"; }
    badge.style.display = "inline-flex";
    badge.querySelector("code").textContent = state.householdId || "";
  } else {
    text.textContent = "Salvo automaticamente neste navegador (modo local)";
    badge.style.display = "none";
  }
}

// ================= AÇÕES (escrita) =================
const Actions = {
  addEntry(entry) {
    if (state.mode === "cloud") {
      fsApi.addDoc(fsApi.collection(db, "households", state.householdId, "entries"), entry).catch((err) => alert("Erro ao salvar: " + err.message));
    } else {
      state.entries.push({ id: uid(), ...entry });
      localSave();
    }
  },
  updateEntry(id, entry) {
    if (state.mode === "cloud") {
      fsApi.updateDoc(fsApi.doc(db, "households", state.householdId, "entries", id), entry).catch((err) => alert("Erro ao salvar: " + err.message));
    } else {
      const idx = state.entries.findIndex((e) => e.id === id);
      if (idx > -1) state.entries[idx] = { id, ...entry };
      localSave();
    }
  },
  deleteEntry(id) {
    if (state.mode === "cloud") {
      fsApi.deleteDoc(fsApi.doc(db, "households", state.householdId, "entries", id)).catch((err) => alert("Erro ao excluir: " + err.message));
    } else {
      state.entries = state.entries.filter((e) => e.id !== id);
      localSave();
    }
  },
  addParcelamento(p) {
    if (state.mode === "cloud") {
      fsApi.addDoc(fsApi.collection(db, "households", state.householdId, "parcelamentos"), p).catch((err) => alert("Erro ao salvar: " + err.message));
    } else {
      state.parcelamentos.push({ id: uid(), ...p });
      localSave();
    }
  },
  updateParcelamento(id, p) {
    if (state.mode === "cloud") {
      fsApi.updateDoc(fsApi.doc(db, "households", state.householdId, "parcelamentos", id), p).catch((err) => alert("Erro ao salvar: " + err.message));
    } else {
      const idx = state.parcelamentos.findIndex((x) => x.id === id);
      if (idx > -1) state.parcelamentos[idx] = { id, ...p };
      localSave();
    }
  },
  deleteParcelamento(id) {
    if (state.mode === "cloud") {
      fsApi.deleteDoc(fsApi.doc(db, "households", state.householdId, "parcelamentos", id)).catch((err) => alert("Erro ao excluir: " + err.message));
    } else {
      state.parcelamentos = state.parcelamentos.filter((x) => x.id !== id);
      localSave();
    }
  },
  setRenda(ym, data) {
    if (state.mode === "cloud") {
      fsApi.setDoc(fsApi.doc(db, "households", state.householdId, "renda", ym), data, { merge: true }).catch((err) => alert("Erro ao salvar: " + err.message));
    } else {
      state.renda[ym] = { ...(state.renda[ym] || {}), ...data };
      localSave();
    }
  },
  updateHouseholdMeta(partial) {
    Object.assign(state.household, partial);
    if (state.mode === "cloud") {
      fsApi.setDoc(fsApi.doc(db, "households", state.householdId), partial, { merge: true }).catch((err) => alert("Erro ao salvar: " + err.message));
    } else {
      localSave();
    }
    refreshCategorySelect();
    refreshPaymentSelects();
    renderAll();
  }
};

// ================= cálculos =================
function parcelamentoMonthsRange(p) {
  const startIdx = p.anoInicio * 12 + (p.mesInicio - 1);
  const endIdx = startIdx + p.totalParcelas - 1;
  return { startIdx, endIdx };
}
function parcelamentoActiveInMonth(p, year, month) {
  const idx = year * 12 + month;
  const { startIdx, endIdx } = parcelamentoMonthsRange(p);
  return idx >= startIdx && idx <= endIdx;
}
function parcelamentoStatusToday(p) {
  const today = new Date();
  const todayIdx = today.getFullYear() * 12 + today.getMonth();
  const { startIdx, endIdx } = parcelamentoMonthsRange(p);
  let parcelaAtual = todayIdx - startIdx + 1;
  if (parcelaAtual < 1) parcelaAtual = 0;
  if (parcelaAtual > p.totalParcelas) parcelaAtual = p.totalParcelas;
  const quitado = todayIdx > endIdx;
  const restantes = Math.max(0, p.totalParcelas - Math.max(0, parcelaAtual));
  const quitYear = Math.floor(endIdx / 12);
  const quitMonth = ((endIdx % 12) + 12) % 12;
  return {
    parcelaAtual: Math.max(0, parcelaAtual),
    restantes,
    quitado,
    valorRestante: p.valorParcela * restantes,
    quitMonthLabel: `${MONTH_NAMES[quitMonth].slice(0, 3)}/${String(quitYear).slice(2)}`
  };
}

function manualEntriesForMonth(year, month) {
  return state.entries.filter((e) => {
    const d = new Date(e.data + "T00:00:00");
    return d.getFullYear() === year && d.getMonth() === month;
  });
}
function effectiveEntriesForMonth(year, month) {
  const manual = manualEntriesForMonth(year, month);
  const parcelas = state.parcelamentos
    .filter((p) => parcelamentoActiveInMonth(p, year, month))
    .map((p) => ({
      id: "parcela:" + p.id,
      tipo: "gasto",
      data: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      categoria: p.categoria,
      descricao: p.descricao,
      quem: p.quem,
      formaPagamento: p.formaPagamento || "",
      classificacao: "Parcelado",
      valor: p.valorParcela,
      synthetic: true
    }));
  return manual.concat(parcelas);
}
function summarize(list) {
  let r = 0, g = 0;
  list.forEach((e) => { if (e.tipo === "receita") r += e.valor; else g += e.valor; });
  return { receitas: r, gastos: g, saldo: r - g };
}
function summarizeByPerson(list, people) {
  const out = {};
  people.forEach((p) => (out[p] = 0));
  list.forEach((e) => { if (e.tipo === "gasto") out[e.quem] = (out[e.quem] || 0) + e.valor; });
  return out;
}
function rendaForMonth(year, month) {
  const ym = monthKey(year, month);
  const base = state.renda[ym] || { yago: 0, gabriela: 0, casa: 0 };
  const extra = state.entries.filter((e) => {
    const d = new Date(e.data + "T00:00:00");
    return e.tipo === "receita" && d.getFullYear() === year && d.getMonth() === month;
  }).reduce((s, e) => s + e.valor, 0);
  const total = (Number(base.yago) || 0) + (Number(base.gabriela) || 0) + (Number(base.casa) || 0) + extra;
  return { yago: base.yago || 0, gabriela: base.gabriela || 0, casa: base.casa || 0, extra, total };
}
function computeStats(year, month) {
  const list = effectiveEntriesForMonth(year, month);
  const sum = summarize(list);
  const renda = rendaForMonth(year, month);
  const saldo = renda.total - sum.gastos;
  const poupanca = renda.total > 0 ? saldo / renda.total : 0;

  let pm = month - 1, py = year;
  if (pm < 0) { pm = 11; py--; }
  const prevSum = summarize(effectiveEntriesForMonth(py, pm));
  const deltaGasto = prevSum.gastos > 0 ? (sum.gastos - prevSum.gastos) / prevSum.gastos : null;

  const gastosList = list.filter((e) => e.tipo === "gasto");
  const maior = gastosList.reduce((max, e) => (e.valor > (max ? max.valor : -1) ? e : max), null);

  const hoje = new Date();
  const isMesAtual = hoje.getFullYear() === year && hoje.getMonth() === month;
  const diasNoMes = new Date(year, month + 1, 0).getDate();
  const diasPassados = isMesAtual ? hoje.getDate() : diasNoMes;
  const mediaDiaria = diasPassados > 0 ? sum.gastos / diasPassados : 0;
  const projecao = isMesAtual ? mediaDiaria * diasNoMes : sum.gastos;

  const porPessoa = summarizeByPerson(list, PEOPLE);
  const gastoCasal = (porPessoa.Yago || 0) + (porPessoa.Gabriela || 0);
  const rendaCasal = (Number(renda.yago) || 0) + (Number(renda.gabriela) || 0);

  return {
    sum, renda, saldo, poupanca, deltaGasto, maior, mediaDiaria, projecao, isMesAtual,
    divisao: {
      gastoYagoPct: gastoCasal > 0 ? (porPessoa.Yago || 0) / gastoCasal : 0,
      gastoGabrielaPct: gastoCasal > 0 ? (porPessoa.Gabriela || 0) / gastoCasal : 0,
      rendaYagoPct: rendaCasal > 0 ? (Number(renda.yago) || 0) / rendaCasal : 0,
      rendaGabrielaPct: rendaCasal > 0 ? (Number(renda.gabriela) || 0) / rendaCasal : 0
    },
    porPessoa
  };
}

// ================= entrada / household =================
function generateHouseholdId() {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return "casa-" + Array.from(bytes, (b) => b.toString(36)).join("").slice(0, 10);
  } catch (e) {
    return "casa-" + Math.random().toString(36).slice(2, 12);
  }
}
function showJoinOverlay() {
  $("joinCreateId").value = generateHouseholdId();
  $("joinOverlay").style.display = "flex";
}
function hideJoinOverlay() { $("joinOverlay").style.display = "none"; }

// ================= render =================
function renderHeader() {
  $("monthLabel").textContent = MONTH_NAMES[state.view.month] + " de " + state.view.year;
  $("donutMonthLabel").textContent = MONTH_NAMES[state.view.month] + "/" + state.view.year;
}

function renderCards(effList) {
  const s = summarize(effList);
  const renda = rendaForMonth(state.view.year, state.view.month);
  $("cardReceitas").textContent = currency(renda.total);
  $("cardGastos").textContent = currency(s.gastos);
  const saldo = renda.total - s.gastos;
  $("cardSaldo").textContent = currency(saldo);
  $("cardCount").textContent = manualEntriesForMonth(state.view.year, state.view.month).length;
  const box = $("cardSaldoBox");
  box.classList.remove("balance-pos", "balance-neg");
  box.classList.add(saldo >= 0 ? "balance-pos" : "balance-neg");
}

function renderPersonCards(effList) {
  const box = $("personCards");
  box.innerHTML = "";
  const totals = summarizeByPerson(effList, PEOPLE);
  PEOPLE.forEach((p) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="label">Gasto ${p}</div><div class="value small">${currency(totals[p] || 0)}</div>`;
    box.appendChild(card);
  });
}

function renderStats() {
  const box = $("statsGrid");
  box.innerHTML = "";
  const st = computeStats(state.view.year, state.view.month);

  const c1 = document.createElement("div");
  c1.className = "card";
  c1.innerHTML = `<div class="label">Taxa de poupança</div><div class="value small">${(st.poupanca * 100).toFixed(0)}%</div><div class="stat-note">saldo ÷ renda do mês</div>`;
  box.appendChild(c1);

  const c2 = document.createElement("div");
  c2.className = "card";
  let deltaHtml = `<div class="stat-note">sem mês anterior p/ comparar</div>`;
  if (st.deltaGasto !== null) {
    const up = st.deltaGasto >= 0;
    deltaHtml = `<div class="delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(st.deltaGasto * 100).toFixed(0)}% vs. mês anterior</div>`;
  }
  c2.innerHTML = `<div class="label">Gasto total</div><div class="value small">${currency(st.sum.gastos)}</div>${deltaHtml}`;
  box.appendChild(c2);

  const c3 = document.createElement("div");
  c3.className = "card";
  c3.innerHTML = st.maior
    ? `<div class="label">Maior gasto do mês</div><div class="value small">${currency(st.maior.valor)}</div><div class="stat-note">${st.maior.categoria}${st.maior.descricao ? " · " + st.maior.descricao : ""}</div>`
    : `<div class="label">Maior gasto do mês</div><div class="value small">—</div>`;
  box.appendChild(c3);

  const c4 = document.createElement("div");
  c4.className = "card";
  c4.innerHTML = `<div class="label">Gasto médio diário</div><div class="value small">${currency(st.mediaDiaria)}</div>`;
  box.appendChild(c4);

  if (st.isMesAtual) {
    const c5 = document.createElement("div");
    c5.className = "card";
    c5.innerHTML = `<div class="label">Projeção de fechamento</div><div class="value small">${currency(st.projecao)}</div><div class="stat-note">no ritmo atual</div>`;
    box.appendChild(c5);
  }

  const c6 = document.createElement("div");
  c6.className = "card";
  c6.innerHTML = `<div class="label">Divisão do casal</div>
    <div class="stat-note">Yago: ${(st.divisao.gastoYagoPct * 100).toFixed(0)}% do gasto · ${(st.divisao.rendaYagoPct * 100).toFixed(0)}% da renda</div>
    <div class="stat-note">Gabriela: ${(st.divisao.gastoGabrielaPct * 100).toFixed(0)}% do gasto · ${(st.divisao.rendaGabrielaPct * 100).toFixed(0)}% da renda</div>`;
  box.appendChild(c6);
}

function renderTable(list) {
  const body = $("entryTableBody");
  body.innerHTML = "";
  const sorted = list.slice().sort((a, b) => b.data.localeCompare(a.data));
  $("tableEmpty").style.display = sorted.length ? "none" : "block";
  sorted.forEach((e) => {
    const tr = document.createElement("tr");
    const dataFmt = new Date(e.data + "T00:00:00").toLocaleDateString("pt-BR");
    const tipoLabel = e.tipo === "receita" ? "Receita" : (e.classificacao || "—");
    tr.innerHTML = `<td>${dataFmt}</td><td>${e.categoria}</td><td>${e.quem || "—"}</td><td><span class="tag">${tipoLabel}</span></td><td>${e.formaPagamento || "—"}</td><td>${e.descricao || "—"}</td><td class="val ${e.tipo}">${e.tipo === "receita" ? "+" : "-"} ${currency(e.valor)}</td><td class="row-actions"></td>`;
    const actions = tr.querySelector(".row-actions");
    const editBtn = document.createElement("button");
    editBtn.className = "ghost"; editBtn.textContent = "✎"; editBtn.title = "Editar";
    editBtn.addEventListener("click", () => startEditEntry(e.id));
    const delBtn = document.createElement("button");
    delBtn.className = "ghost danger"; delBtn.textContent = "🗑"; delBtn.title = "Excluir";
    delBtn.addEventListener("click", () => confirmDeleteEntry(e.id));
    actions.appendChild(editBtn); actions.appendChild(delBtn);
    body.appendChild(tr);
  });
}
function confirmDeleteEntry(id) {
  if (!confirm("Excluir este lançamento?")) return;
  Actions.deleteEntry(id);
  renderAll();
}

function renderDonut(gastos) {
  const wrap = $("donutWrap");
  if (!gastos.length) { wrap.innerHTML = "<div class='empty'>Sem gastos neste mês ainda.</div>"; return; }
  const byCat = {};
  gastos.forEach((e) => { byCat[e.categoria] = (byCat[e.categoria] || 0) + e.valor; });
  const total = Object.values(byCat).reduce((a, b) => a + b, 0);
  const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  let acc = 0; const parts = []; let legend = "";
  cats.forEach((cat, i) => {
    const color = PALETTE[i % PALETTE.length];
    const pct = (byCat[cat] / total) * 100;
    parts.push(`${color} ${acc}% ${acc + pct}%`); acc += pct;
    legend += `<li><span class="name"><span class="sw" style="background:${color}"></span>${cat} <span style="color:var(--muted);margin-left:4px;">(${pct.toFixed(0)}%)</span></span><span class="amt">${currency(byCat[cat])}</span></li>`;
  });
  wrap.innerHTML = `<div class="donut" style="background:conic-gradient(${parts.join(",")})"><div class="hole"><b>${currency(total)}</b><span>total gasto</span></div></div><ul class="legend">${legend}</ul>`;
}

function renderTrend() {
  const chart = $("trendChart");
  chart.innerHTML = "";
  const months = [];
  for (let i = 5; i >= 0; i--) {
    let m = state.view.month - i, y = state.view.year;
    while (m < 0) { m += 12; y--; }
    months.push({ year: y, month: m });
  }
  const sums = months.map((mo) => ({
    receitas: rendaForMonth(mo.year, mo.month).total,
    gastos: summarize(effectiveEntriesForMonth(mo.year, mo.month)).gastos
  }));
  const max = Math.max(...sums.map((s) => Math.max(s.receitas, s.gastos)), 1);

  months.forEach((mo, i) => {
    const s = sums[i];
    const group = document.createElement("div"); group.className = "bar-group";
    const bars = document.createElement("div"); bars.className = "bars";
    const rBar = document.createElement("div"); rBar.className = "bar receita";
    rBar.style.height = Math.max(2, (s.receitas / max) * 120) + "px";
    rBar.title = "Receitas: " + currency(s.receitas);
    const gBar = document.createElement("div"); gBar.className = "bar gasto";
    gBar.style.height = Math.max(2, (s.gastos / max) * 120) + "px";
    gBar.title = "Gastos: " + currency(s.gastos);
    bars.appendChild(rBar); bars.appendChild(gBar);
    const label = document.createElement("div"); label.className = "m-label";
    label.textContent = MONTH_NAMES[mo.month].slice(0, 3) + "/" + String(mo.year).slice(2);
    group.appendChild(bars); group.appendChild(label);
    chart.appendChild(group);
  });
}

function renderRenda() {
  const ym = monthKey(state.view.year, state.view.month);
  const r = state.renda[ym] || {};
  $("rendaYago").value = r.yago ?? "";
  $("rendaGabriela").value = r.gabriela ?? "";
  $("rendaCasa").value = r.casa ?? "";
  const total = (Number(r.yago) || 0) + (Number(r.gabriela) || 0) + (Number(r.casa) || 0);
  $("rendaTotalDisplay").value = currency(total);
  $("rendaMonthLabel").textContent = MONTH_NAMES[state.view.month] + "/" + state.view.year;
}

function renderParcelamentos() {
  const body = $("parcelaTableBody");
  body.innerHTML = "";
  const list = state.parcelamentos.slice().sort((a, b) => (b.anoInicio * 12 + b.mesInicio) - (a.anoInicio * 12 + a.mesInicio));
  $("parcelaEmpty").style.display = list.length ? "none" : "block";
  list.forEach((p) => {
    const st = parcelamentoStatusToday(p);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${p.descricao}</td><td>${p.categoria}</td><td>${p.quem}</td>
      <td>${Math.max(1, Math.min(st.parcelaAtual, p.totalParcelas))}/${p.totalParcelas}</td>
      <td>${st.restantes}</td><td>${st.quitMonthLabel}</td>
      <td><span class="pill ${st.quitado ? "quitado" : "andamento"}">${st.quitado ? "Quitado" : "Em andamento"}</span></td>
      <td class="val gasto">${currency(p.valorParcela)}</td>
      <td class="row-actions"></td>`;
    const actions = tr.querySelector(".row-actions");
    const editBtn = document.createElement("button");
    editBtn.className = "ghost"; editBtn.textContent = "✎"; editBtn.title = "Editar";
    editBtn.addEventListener("click", () => startEditParcela(p.id));
    const delBtn = document.createElement("button");
    delBtn.className = "ghost danger"; delBtn.textContent = "🗑"; delBtn.title = "Excluir";
    delBtn.addEventListener("click", () => confirmDeleteParcela(p.id));
    actions.appendChild(editBtn); actions.appendChild(delBtn);
    body.appendChild(tr);
  });
}
function confirmDeleteParcela(id) {
  if (!confirm("Excluir este parcelamento?")) return;
  Actions.deleteParcelamento(id);
  renderAll();
}

function renderCategoryManager() {
  ["gasto", "receita"].forEach((tipo) => {
    const box = $(tipo === "gasto" ? "catListGasto" : "catListReceita");
    box.innerHTML = "";
    state.household.categorias[tipo].forEach((cat) => {
      const chip = document.createElement("span"); chip.className = "cat-chip";
      const span = document.createElement("span"); span.textContent = cat;
      const del = document.createElement("button");
      del.type = "button"; del.textContent = "✕"; del.title = "Remover categoria";
      del.addEventListener("click", () => {
        const inUse = state.entries.some((e) => e.tipo === tipo && e.categoria === cat) || (tipo === "gasto" && state.parcelamentos.some((p) => p.categoria === cat));
        if (inUse && !confirm(`A categoria "${cat}" já tem lançamentos. Remover mesmo assim? (os lançamentos existentes mantêm o nome da categoria)`)) return;
        const novas = { ...state.household.categorias, [tipo]: state.household.categorias[tipo].filter((c) => c !== cat) };
        Actions.updateHouseholdMeta({ categorias: novas });
      });
      chip.appendChild(span); chip.appendChild(del); box.appendChild(chip);
    });
  });
}
function renderPaymentManager() {
  const box = $("paymentList");
  box.innerHTML = "";
  state.household.formasPagamento.forEach((fp) => {
    const chip = document.createElement("span"); chip.className = "cat-chip";
    const span = document.createElement("span"); span.textContent = fp;
    const del = document.createElement("button");
    del.type = "button"; del.textContent = "✕"; del.title = "Remover";
    del.addEventListener("click", () => {
      const inUse = state.entries.some((e) => e.formaPagamento === fp) || state.parcelamentos.some((p) => p.formaPagamento === fp);
      if (inUse && !confirm(`"${fp}" já está em uso. Remover mesmo assim?`)) return;
      Actions.updateHouseholdMeta({ formasPagamento: state.household.formasPagamento.filter((f) => f !== fp) });
    });
    chip.appendChild(span); chip.appendChild(del); box.appendChild(chip);
  });
}

function renderAnnualSummary() {
  $("yearLabel").textContent = state.annualYear;
  const body = $("annualTableBody");
  body.innerHTML = "";
  const totals = { yago: 0, gabriela: 0, casa: 0, gasto: 0, renda: 0 };
  for (let m = 0; m < 12; m++) {
    const eff = effectiveEntriesForMonth(state.annualYear, m);
    const byPerson = summarizeByPerson(eff, PEOPLE);
    const gastoTotal = summarize(eff).gastos;
    const renda = rendaForMonth(state.annualYear, m).total;
    const saldo = renda - gastoTotal;
    const pct = renda > 0 ? gastoTotal / renda : 0;
    totals.yago += byPerson.Yago || 0; totals.gabriela += byPerson.Gabriela || 0; totals.casa += byPerson.Casa || 0;
    totals.gasto += gastoTotal; totals.renda += renda;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${MONTH_NAMES[m].charAt(0).toUpperCase() + MONTH_NAMES[m].slice(1)}</td>
      <td>${currency(byPerson.Yago || 0)}</td><td>${currency(byPerson.Gabriela || 0)}</td><td>${currency(byPerson.Casa || 0)}</td>
      <td class="val gasto">${currency(gastoTotal)}</td><td class="val receita">${currency(renda)}</td>
      <td class="val ${saldo >= 0 ? "receita" : "gasto"}">${currency(saldo)}</td><td>${(pct * 100).toFixed(0)}%</td>`;
    body.appendChild(tr);
  }
  const saldoTotal = totals.renda - totals.gasto;
  const pctTotal = totals.renda > 0 ? totals.gasto / totals.renda : 0;
  $("annualTableFoot").innerHTML = `<tr style="font-weight:600;"><td>Total / Média</td>
    <td>${currency(totals.yago)}</td><td>${currency(totals.gabriela)}</td><td>${currency(totals.casa)}</td>
    <td>${currency(totals.gasto)}</td><td>${currency(totals.renda)}</td>
    <td>${currency(saldoTotal)}</td><td>${(pctTotal * 100).toFixed(0)}%</td></tr>`;
}

function renderAll() {
  renderHeader();
  const manualList = manualEntriesForMonth(state.view.year, state.view.month);
  const effList = effectiveEntriesForMonth(state.view.year, state.view.month);
  renderCards(effList);
  renderPersonCards(effList);
  renderStats();
  renderTable(manualList);
  renderDonut(effList.filter((e) => e.tipo === "gasto"));
  renderTrend();
  renderRenda();
  renderParcelamentos();
  renderCategoryManager();
  renderPaymentManager();
  renderAnnualSummary();
}

// ================= formulário: lançamento =================
function refreshCategorySelect() {
  $("fCategoria").innerHTML = state.household.categorias[state.currentType].map((c) => `<option value="${c}">${c}</option>`).join("");
  $("pCategoria").innerHTML = state.household.categorias.gasto.map((c) => `<option value="${c}">${c}</option>`).join("");
}
function refreshPaymentSelects() {
  const opts = state.household.formasPagamento.map((f) => `<option value="${f}">${f}</option>`).join("");
  $("fFormaPagamento").innerHTML = opts;
  $("pFormaPagamento").innerHTML = opts;
}
function populateStaticSelects() {
  [$("fQuem"), $("pQuem")].forEach((sel) => {
    sel.innerHTML = PEOPLE.map((p) => `<option value="${p}">${p}</option>`).join("");
  });
  $("pMes").innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i + 1}">${m.charAt(0).toUpperCase() + m.slice(1)}</option>`).join("");
  $("pAno").value = new Date().getFullYear();
}

function startEditEntry(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  state.editingId = id;
  state.currentType = entry.tipo;
  document.querySelectorAll(".type-toggle button").forEach((b) => b.classList.toggle("active", b.getAttribute("data-t") === entry.tipo));
  $("fClassificacaoWrap").style.display = entry.tipo === "gasto" ? "block" : "none";
  refreshCategorySelect();
  $("fData").value = entry.data;
  $("fCategoria").value = entry.categoria;
  $("fQuem").value = entry.quem;
  $("fFormaPagamento").value = entry.formaPagamento || "";
  if (entry.tipo === "gasto") $("fClassificacao").value = entry.classificacao || "Variável";
  $("fDescricao").value = entry.descricao;
  $("fValor").value = entry.valor;
  $("btnSubmit").textContent = "Salvar alteração";
  $("btnCancelEdit").style.display = "inline-block";
  $("formTitle").textContent = "Editando lançamento";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".type-toggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".type-toggle button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.currentType = btn.getAttribute("data-t");
    $("fClassificacaoWrap").style.display = state.currentType === "gasto" ? "block" : "none";
    refreshCategorySelect();
  });
});

$("entryForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const valor = parseFloat($("fValor").value);
  if (isNaN(valor) || valor <= 0) return;
  const entry = {
    tipo: state.currentType,
    data: $("fData").value,
    categoria: $("fCategoria").value,
    quem: $("fQuem").value,
    formaPagamento: $("fFormaPagamento").value || "",
    classificacao: state.currentType === "gasto" ? $("fClassificacao").value : "",
    descricao: $("fDescricao").value.trim(),
    valor
  };
  if (state.editingId) {
    Actions.updateEntry(state.editingId, entry);
    state.editingId = null;
    $("btnSubmit").textContent = "Adicionar";
    $("btnCancelEdit").style.display = "none";
    $("formTitle").textContent = "Novo lançamento";
  } else {
    Actions.addEntry(entry);
  }
  const d = new Date(entry.data + "T00:00:00");
  state.view = { year: d.getFullYear(), month: d.getMonth() };
  $("entryForm").reset();
  $("fData").valueAsDate = new Date();
  refreshCategorySelect();
  renderAll();
});
$("btnCancelEdit").addEventListener("click", () => {
  state.editingId = null;
  $("entryForm").reset();
  $("fData").valueAsDate = new Date();
  $("btnSubmit").textContent = "Adicionar";
  $("btnCancelEdit").style.display = "none";
  $("formTitle").textContent = "Novo lançamento";
});

// ================= formulário: parcelamento =================
function startEditParcela(id) {
  const p = state.parcelamentos.find((x) => x.id === id);
  if (!p) return;
  state.editingParcelaId = id;
  $("pDescricao").value = p.descricao;
  $("pCategoria").value = p.categoria;
  $("pQuem").value = p.quem;
  $("pFormaPagamento").value = p.formaPagamento || "";
  $("pValor").value = p.valorParcela;
  $("pMes").value = p.mesInicio;
  $("pAno").value = p.anoInicio;
  $("pTotal").value = p.totalParcelas;
  $("btnSubmitParcela").textContent = "Salvar alteração";
  $("btnCancelEditParcela").style.display = "inline-block";
  $("formTitleParcela").textContent = "Editando parcelamento";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("parcelaForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const valor = parseFloat($("pValor").value);
  const total = parseInt($("pTotal").value, 10);
  if (isNaN(valor) || valor <= 0 || isNaN(total) || total < 1) return;
  const p = {
    descricao: $("pDescricao").value.trim(),
    categoria: $("pCategoria").value,
    quem: $("pQuem").value,
    formaPagamento: $("pFormaPagamento").value || "",
    valorParcela: valor,
    mesInicio: parseInt($("pMes").value, 10),
    anoInicio: parseInt($("pAno").value, 10),
    totalParcelas: total
  };
  if (state.editingParcelaId) {
    Actions.updateParcelamento(state.editingParcelaId, p);
    state.editingParcelaId = null;
    $("btnSubmitParcela").textContent = "Adicionar parcelamento";
    $("btnCancelEditParcela").style.display = "none";
    $("formTitleParcela").textContent = "Novo parcelamento";
  } else {
    Actions.addParcelamento(p);
  }
  $("parcelaForm").reset();
  $("pAno").value = new Date().getFullYear();
  renderAll();
});
$("btnCancelEditParcela").addEventListener("click", () => {
  state.editingParcelaId = null;
  $("parcelaForm").reset();
  $("pAno").value = new Date().getFullYear();
  $("btnSubmitParcela").textContent = "Adicionar parcelamento";
  $("btnCancelEditParcela").style.display = "none";
  $("formTitleParcela").textContent = "Novo parcelamento";
});

// ================= renda =================
[["rendaYago", "yago"], ["rendaGabriela", "gabriela"], ["rendaCasa", "casa"]].forEach(([elId, key]) => {
  $(elId).addEventListener("change", () => {
    const ym = monthKey(state.view.year, state.view.month);
    const val = parseFloat($(elId).value) || 0;
    Actions.setRenda(ym, { [key]: val });
    renderAll();
  });
});

// ================= categorias / formas de pagamento =================
$("btnAddCat").addEventListener("click", () => {
  const tipo = $("catAddTipo").value;
  const nome = $("catAddNome").value.trim();
  if (!nome) return;
  if (state.household.categorias[tipo].indexOf(nome) === -1) {
    Actions.updateHouseholdMeta({ categorias: { ...state.household.categorias, [tipo]: [...state.household.categorias[tipo], nome] } });
  }
  $("catAddNome").value = "";
});
$("btnAddPayment").addEventListener("click", () => {
  const nome = $("paymentAddNome").value.trim();
  if (!nome) return;
  if (state.household.formasPagamento.indexOf(nome) === -1) {
    Actions.updateHouseholdMeta({ formasPagamento: [...state.household.formasPagamento, nome] });
  }
  $("paymentAddNome").value = "";
});

// ================= navegação =================
$("prevMonth").addEventListener("click", () => { state.view.month--; if (state.view.month < 0) { state.view.month = 11; state.view.year--; } renderAll(); });
$("nextMonth").addEventListener("click", () => { state.view.month++; if (state.view.month > 11) { state.view.month = 0; state.view.year++; } renderAll(); });
$("btnToday").addEventListener("click", () => { const d = new Date(); state.view = { year: d.getFullYear(), month: d.getMonth() }; renderAll(); });
$("prevYear").addEventListener("click", () => { state.annualYear--; renderAll(); });
$("nextYear").addEventListener("click", () => { state.annualYear++; renderAll(); });

// ================= entrada / household UI =================
$("joinTabCreate").addEventListener("click", () => {
  $("joinTabCreate").classList.add("active"); $("joinTabJoin").classList.remove("active");
  $("joinCreatePane").style.display = "block"; $("joinJoinPane").style.display = "none";
});
$("joinTabJoin").addEventListener("click", () => {
  $("joinTabJoin").classList.add("active"); $("joinTabCreate").classList.remove("active");
  $("joinJoinPane").style.display = "block"; $("joinCreatePane").style.display = "none";
});
$("btnCopyHouseholdId").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("joinCreateId").value);
    $("btnCopyHouseholdId").textContent = "Copiado!";
    setTimeout(() => { $("btnCopyHouseholdId").textContent = "Copiar"; }, 1500);
  } catch (e) {}
});
$("btnConfirmCreate").addEventListener("click", () => {
  const id = $("joinCreateId").value.trim();
  if (!id) return;
  localStorage.setItem(HOUSEHOLD_KEY, id);
  hideJoinOverlay();
  initCloud(id);
});
$("btnConfirmJoin").addEventListener("click", () => {
  const id = $("joinExistingId").value.trim();
  if (!id) return;
  localStorage.setItem(HOUSEHOLD_KEY, id);
  hideJoinOverlay();
  initCloud(id);
});
$("btnChangeHousehold").addEventListener("click", () => {
  if (!confirm("Trocar de espaço? Você vai sair do espaço atual e poderá entrar em outro.")) return;
  localStorage.removeItem(HOUSEHOLD_KEY);
  location.reload();
});

// ================= exportar / importar =================
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function exportJson() {
  const data = { household: state.household, entries: state.entries, parcelamentos: state.parcelamentos, renda: state.renda, exportedAt: new Date().toISOString() };
  const ts = new Date().toISOString().slice(0, 10);
  downloadBlob(JSON.stringify(data, null, 2), `controle-financeiro-casal-backup-${ts}.json`, "application/json");
}
function exportCsv() {
  const rows = [["Data", "Categoria", "Quem", "Tipo", "Forma de Pagamento", "Descrição", "Valor"]];
  state.entries.slice().sort((a, b) => a.data.localeCompare(b.data)).forEach((e) => {
    rows.push([e.data, e.categoria, e.quem || "", e.tipo === "receita" ? "Receita" : (e.classificacao || ""), e.formaPagamento || "", (e.descricao || "").replace(/"/g, '""'), e.valor.toFixed(2).replace(".", ",")]);
  });
  const csv = rows.map((r) => r.map((f) => (/[",;\n]/.test(f) ? '"' + f + '"' : f)).join(";")).join("\r\n");
  const ts = new Date().toISOString().slice(0, 10);
  downloadBlob("﻿" + csv, `controle-financeiro-casal-${ts}.csv`, "text/csv;charset=utf-8;");
}
async function importIntoCloud(data) {
  try {
    const hRef = fsApi.doc(db, "households", state.householdId);
    if (data.household) await fsApi.setDoc(hRef, data.household, { merge: true });
    const wipe = async (colName) => {
      const snap = await fsApi.getDocs(fsApi.collection(db, "households", state.householdId, colName));
      await Promise.all(snap.docs.map((d) => fsApi.deleteDoc(d.ref)));
    };
    await wipe("entries");
    await wipe("parcelamentos");
    await wipe("renda");
    for (const entry of (data.entries || [])) { const { id, ...rest } = entry; await fsApi.addDoc(fsApi.collection(db, "households", state.householdId, "entries"), rest); }
    for (const p of (data.parcelamentos || [])) { const { id, ...rest } = p; await fsApi.addDoc(fsApi.collection(db, "households", state.householdId, "parcelamentos"), rest); }
    for (const ym of Object.keys(data.renda || {})) { await fsApi.setDoc(fsApi.doc(db, "households", state.householdId, "renda", ym), data.renda[ym]); }
  } catch (err) {
    alert("Erro ao importar para o espaço sincronizado: " + err.message);
  }
}
function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.entries) throw new Error("formato inválido");
      if (!confirm("Importar vai SUBSTITUIR os dados atuais pelos do arquivo. Continuar?")) return;
      if (state.mode === "cloud") {
        importIntoCloud(data).then(() => alert("Backup importado com sucesso."));
      } else {
        state.household = data.household || state.household;
        state.entries = data.entries || [];
        state.parcelamentos = data.parcelamentos || [];
        state.renda = data.renda || {};
        localSave();
        refreshCategorySelect();
        refreshPaymentSelects();
        renderAll();
        alert("Backup importado com sucesso.");
      }
    } catch (err) {
      alert("Não foi possível ler este arquivo. Verifique se é um backup JSON exportado por esta mesma página.");
    }
  };
  reader.readAsText(file);
}
$("btnExportJson").addEventListener("click", exportJson);
$("btnBannerExport").addEventListener("click", exportJson);
$("btnExportCsv").addEventListener("click", exportCsv);
$("btnImportJson").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (e) => {
  if (e.target.files[0]) importJson(e.target.files[0]);
  e.target.value = "";
});

// ================= init =================
async function boot() {
  populateStaticSelects();
  $("fData").valueAsDate = new Date();

  if (!firebaseConfig) {
    state.mode = "local";
    if (storageOk) {
      localLoad();
    } else {
      $("storageBanner").style.display = "flex";
      $("storageBannerText").textContent = "Não foi possível salvar neste navegador (comum em modo anônimo/privado). Exporte o backup (JSON) antes de fechar para não perder os dados.";
      window.addEventListener("beforeunload", (e) => { if (state.entries.length) { e.preventDefault(); e.returnValue = ""; } });
    }
    refreshCategorySelect();
    refreshPaymentSelects();
    updateSaveStatus();
    renderAll();
    return;
  }

  const savedId = localStorage.getItem(HOUSEHOLD_KEY);
  if (savedId) {
    await initCloud(savedId);
  } else {
    showJoinOverlay();
  }
}
boot();
