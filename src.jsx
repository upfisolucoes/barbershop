import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction } from 'firebase/firestore';
import { auth, db } from './firebase';
import './style.css';

const money = n => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);
const number = x => Number(x) || 0;
const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => localISO();
const addDays = (iso, days) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + days); return localISO(dt); };
const dayDiff = (from, to) => { const a = Date.parse(from + 'T12:00:00Z'), b = Date.parse(to + 'T12:00:00Z'); return Math.round((b - a) / 86400000); };
const monthShift = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const dueInMonth = (ym, day) => { const [y, m] = ym.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return `${ym}-${String(Math.min(Math.max(Number(day) || 1, 1), last)).padStart(2, '0')}`; };
const categories = ['Água', 'Energia elétrica', 'Aluguel', 'Internet', 'Lavanderia', 'Produtos e insumos', 'Manutenção e consertos', 'Equipamentos', 'Limpeza', 'Salários e comissões', 'Impostos', 'Marketing', 'Outros'];
const methods = ['Pix', 'Dinheiro', 'Débito', 'Crédito', 'Transferência', 'Outro'];
const defs = {
  services: { title: 'Serviços', fields: [['name', 'Nome', 'text', true], ['price', 'Preço (R$)', 'number', true], ['duration', 'Duração (min)', 'number']] },
  appointments: { title: 'Atendimentos', fields: [['date', 'Data', 'date', true], ['customer', 'Cliente / identificação', 'text'], ['service', 'Serviço', 'text', true], ['amount', 'Valor bruto (R$)', 'number', true], ['discount', 'Desconto (R$)', 'number'], ['fee', 'Taxa do cartão (%)', 'number'], ['method', 'Pagamento', 'select', true, methods], ['status', 'Situação', 'select', true, ['Pago', 'Pendente', 'Cancelado']], ['notes', 'Observações', 'text']] },
  expenses: { title: 'Despesas', fields: [['date', 'Data do lançamento', 'date', true], ['dueDate', 'Data de vencimento', 'date'], ['category', 'Categoria', 'select', true, categories], ['description', 'Descrição', 'text', true], ['amount', 'Valor (R$)', 'number', true], ['status', 'Situação', 'select', true, ['Pago', 'Pendente']], ['method', 'Pagamento', 'select', false, methods], ['expenseType', 'Tipo de despesa', 'select', true, ['Avulsa', 'Fixa mensal']], ['paidAt', 'Data do pagamento', 'date'], ['fundSource', 'Reserva utilizada', 'select', true, ['Barbearia', 'Pró-labore', 'Margem de segurança']], ['notes', 'Observações', 'text']] },
  income: { title: 'Outras receitas', fields: [['date', 'Data', 'date', true], ['description', 'Descrição', 'text', true], ['amount', 'Valor (R$)', 'number', true], ['method', 'Recebimento', 'select', true, methods], ['status', 'Situação', 'select', true, ['Recebido', 'Pendente']]] },
  products: { title: 'Produtos e estoque', fields: [['name', 'Produto', 'text', true], ['category', 'Categoria', 'text'], ['quantity', 'Quantidade atual', 'number', true], ['min', 'Estoque mínimo', 'number'], ['unit', 'Unidade', 'select', false, ['un', 'ml', 'L', 'kg', 'pacote']], ['cost', 'Custo unitário (R$)', 'number'], ['price', 'Preço de venda (R$)', 'number'], ['supplier', 'Fornecedor', 'text']] },
  equipment: { title: 'Equipamentos', fields: [['name', 'Equipamento', 'text', true], ['brand', 'Marca / modelo', 'text'], ['purchaseDate', 'Data da compra', 'date'], ['purchaseValue', 'Valor de compra (R$)', 'number'], ['condition', 'Estado', 'select', false, ['Operacional', 'Em manutenção', 'Fora de uso']], ['lastMaintenance', 'Última manutenção', 'date'], ['maintenanceCost', 'Custo da manutenção (R$)', 'number'], ['notes', 'Observações', 'text']] }
};
const menu = [['dashboard', 'Visão geral', '◈'], ['appointments', 'Atendimentos', '✂'], ['services', 'Serviços', '▤'], ['expenses', 'Despesas', '↘'], ['income', 'Outras receitas', '↗'], ['products', 'Estoque', '▣'], ['equipment', 'Equipamentos', '⚙'], ['reserves', 'Reservas financeiras', '◉'], ['reports', 'Relatórios', '▥']];
const expenseCollection = () => collection(db, 'erp', 'expenses', 'items');
const isMonthly = x => x.expenseType === 'Fixa mensal';
const dueDate = x => x.dueDate || x.date || '';
const expenseState = x => { if (x.status === 'Pago') return 'Paga'; if (!dueDate(x)) return 'Sem vencimento'; const days = dayDiff(today(), dueDate(x)); return days < 0 ? 'Atrasada' : days <= 7 ? 'A vencer' : 'Pendente'; };
const alertSort = (a, b) => dueDate(a).localeCompare(dueDate(b));

function App() {
  const [user, setUser] = useState(undefined), [admin, setAdmin] = useState(false), [loadingAdmin, setLoadingAdmin] = useState(true);
  const [tab, setTab] = useState('dashboard'), [records, setRecords] = useState({}), [form, setForm] = useState(null);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(today().slice(0, 7)), [query, setQuery] = useState('');
  const [periodFilter, setPeriodFilter] = useState('today');
  const [referenceDate, setReferenceDate] = useState(today());
  const [opening, setOpening] = useState({date: today(), prolabore:'', expenses:'', safety:'', notes:''});
  const [expensesLoaded, setExpensesLoaded] = useState(false), [recurringBusy, setRecurringBusy] = useState(false);
  const generatedKeys = useRef(new Set());
  const generatingRef = useRef(false);

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setLoadingAdmin(!!u); if (!u) setAdmin(false); }), []);
  useEffect(() => { if (!user) { setAdmin(false); setLoadingAdmin(false); return; } return onSnapshot(doc(db, 'admins', user.uid), s => { setAdmin(s.exists() && s.data().role === 'admin' && s.data().active === true); setLoadingAdmin(false); }, e => { setMessage('Não foi possível verificar a permissão: ' + e.code); setAdmin(false); setLoadingAdmin(false); }); }, [user]);
  useEffect(() => {
    if (!admin) { setRecords({}); setExpensesLoaded(false); return; }
    const unsubs = [...Object.keys(defs), 'reserves'].map(k => onSnapshot(collection(db, 'erp', k, 'items'), snap => {
      setRecords(prev => ({ ...prev, [k]: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
      if (k === 'expenses') setExpensesLoaded(true);
    }, e => setMessage('Erro em ' + k + ': ' + e.code)));
    return () => unsubs.forEach(fn => fn());
  }, [admin]);

  const list = k => records[k] || [];
  const validDate = x => (x || '').slice(0, 7) === month;
  const appointments = list('appointments').filter(x => validDate(x.date) && x.status !== 'Cancelado');
  const paid = appointments.filter(x => x.status === 'Pago');
  const periodOptions = [
  ['today', 'Hoje'],
  ['yesterday', 'Ontem'],
  ['2days', 'Últimos 2 dias'],
  ['7days', 'Últimos 7 dias'],
  ['15days', 'Últimos 15 dias'],
  ['month', 'Mensal'],
  ['custom', 'Data específica']
];

  const periodEnd = periodFilter === 'yesterday'
  ? addDays(referenceDate, -1)
  : referenceDate;

  const periodStart = periodFilter === 'yesterday'
  ? periodEnd
  : periodFilter === '2days'
  ? addDays(referenceDate, -1)
  : periodFilter === '7days'
  ? addDays(referenceDate, -6)
  : periodFilter === '15days'
  ? addDays(referenceDate, -14)
  : periodFilter === 'month'
  ? referenceDate.slice(0, 7) + '-01'
  : referenceDate;

  const periodPaid = list('appointments').filter(x =>
  x.status === 'Pago' &&
  x.date >= periodStart &&
  x.date <= periodEnd
);

  const periodGross = periodPaid.reduce(
  (sum, x) => sum + number(x.amount), 0
);

  const periodNet = periodPaid.reduce(
  (sum, x) => sum + Math.max(
    0,
    number(x.amount) - number(x.discount) - number(x.fee)
  ), 0
);
  // Distribuição referente ao intervalo selecionado (não altera os saldos reais das reservas).
  const periodNetCents = periodPaid.reduce((sum,x) => sum + Math.max(0,Math.round(number(x.amount)*100)-Math.round(number(x.discount)*100)-Math.round(number(x.fee)*100)),0);
  const periodSharesCents = [Math.round(periodNetCents*.4),Math.round(periodNetCents*.4)];
  periodSharesCents.push(periodNetCents-periodSharesCents[0]-periodSharesCents[1]);
  const periodExpensesPaid = list('expenses').filter(x => x.status === 'Pago' && !x.recurringSkipped && (x.paidAt || x.date || '') >= periodStart && (x.paidAt || x.date || '') <= periodEnd);
  const periodUsedCents = ['Pró-labore','Barbearia','Margem de segurança'].map(name => periodExpensesPaid.filter(x => ((x.fundSource || 'Barbearia') === 'Despesas' ? 'Barbearia' : (x.fundSource || 'Barbearia')) === name).reduce((sum,x) => sum+Math.round(number(x.amount)*100),0));
  const exp = list('expenses').filter(x => !x.recurringSkipped && validDate(x.date));
  const inc = list('income').filter(x => validDate(x.date));
  const gross = paid.reduce((a, x) => a + number(x.amount), 0);
  const fees = paid.reduce((a, x) => a + number(x.fee) + number(x.discount), 0);
  const other = inc.filter(x => x.status === 'Recebido').reduce((a, x) => a + number(x.amount), 0);
  const spent = exp.filter(x => x.status === 'Pago').reduce((a, x) => a + number(x.amount), 0);
  const profit = gross - fees + other - spent;
  // Reservas acumulativas: somamos eventos históricos até o fim do mês selecionado.
  // Aberturas são valores absolutos adicionados manualmente, sem aplicar 40/40/20.
  const toCents = x => Math.round(number(x) * 100);
  const selectedEnd = month + '-31';
  const historicalPaid = list('appointments').filter(x => x.status === 'Pago' && (x.date || '') <= selectedEnd);
  const historicalExpenses = list('expenses').filter(x => x.status === 'Pago' && !x.recurringSkipped && (x.paidAt || x.date || '') <= selectedEnd);
  const historicalOpening = list('reserves').filter(x => (x.date || '') <= selectedEnd);
  const receivedCents = historicalPaid.reduce((sum,x) => sum + Math.max(0,toCents(x.amount)-toCents(x.discount)-toCents(x.fee)),0);
  const allocationCents = [Math.round(receivedCents * .4), Math.round(receivedCents * .4)];
  allocationCents.push(receivedCents - allocationCents[0] - allocationCents[1]);
  const fundNames = ['Pró-labore','Barbearia','Margem de segurança'];
  const openingCents = fundNames.map((_,i) => historicalOpening.reduce((sum,x) => sum + toCents([x.prolabore,x.expenses,x.safety][i]),0));
  const usedCents = fundNames.map(name => historicalExpenses.filter(x => {
  const source = x.fundSource || 'Despesas';
  return (source === 'Despesas' ? 'Barbearia' : source) === name;
}).reduce((sum, x) => sum + toCents(x.amount), 0));
  const balancesCents = fundNames.map((_,i) => allocationCents[i]+openingCents[i]-usedCents[i]);
  const monthNetCents = paid.reduce((sum,x)=>sum+Math.max(0,toCents(x.amount)-toCents(x.discount)-toCents(x.fee)),0);
  const monthShares = [Math.round(monthNetCents*.4),Math.round(monthNetCents*.4)];
  monthShares.push(monthNetCents-monthShares[0]-monthShares[1]);
  const exportReserveCsv = () => {
    const rows = [['Barbearia Premium - Reservas acumuladas',month],['Reserva','Saldo de abertura','Distribuição acumulada','Despesas pagas acumuladas','Saldo disponível'],...fundNames.map((name,i)=>[name,...[openingCents[i],allocationCents[i],usedCents[i],balancesCents[i]].map(v=>(v/100).toFixed(2))]),[],['Despesas pagas até o mês','Data do pagamento','Descrição','Reserva de origem','Valor'],...historicalExpenses.map(x=>['Despesa',x.paidAt||x.date||'',x.description||'',x.fundSource||'Despesas',number(x.amount).toFixed(2)])];
    const escapeCsv = x => '"'+String(x??'').replaceAll('"','""')+'"';
    const csv = '\ufeff'+rows.map(row=>row.map(escapeCsv).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`barbearia041-reservas-${month}.csv`;a.click();URL.revokeObjectURL(url);
  };
  const saveOpening = async e => {
    e.preventDefault();
    if(!window.confirm('Adicionar estes valores às reservas? Não registre novamente valores já contabilizados em atendimentos.'))return;
    setBusy(true);
    try { await addDoc(collection(db,'erp','reserves','items'),{date:opening.date,prolabore:number(opening.prolabore),expenses:number(opening.expenses),safety:number(opening.safety),notes:opening.notes,createdAt:serverTimestamp()});setOpening({date:today(),prolabore:'',expenses:'',safety:'',notes:''});setMessage('Saldo inicial ou ajuste cadastrado.'); }
    catch(err){setMessage('Erro ao salvar saldo: '+err.message)}finally{setBusy(false)}
  };
  const pending = appointments.filter(x => x.status === 'Pendente').reduce((a, x) => a + number(x.amount) - number(x.discount), 0);
  const alerts = list('expenses').filter(x => !x.recurringSkipped && ['Atrasada', 'A vencer'].includes(expenseState(x))).sort(alertSort);
  const overdue = alerts.filter(x => expenseState(x) === 'Atrasada');

  const resetForm = k => {
    const v = {};
    defs[k].fields.forEach(([key, , type, , opts]) => { v[key] = key === 'date' ? today() : type === 'select' ? opts?.[0] || '' : ''; });
    if (k === 'expenses') { v.dueDate = today(); v.status = 'Pendente'; v.expenseType = 'Avulsa'; v.fundSource = 'Barbearia'; }
    setForm({ type: k, data: v });
  };

  const save = async e => {
    e.preventDefault(); if (!admin || !form) return; setBusy(true);
    try {
      const { type, data } = form; const payload = { ...data };
      defs[type].fields.filter(x => x[2] === 'number').forEach(([k]) => payload[k] = number(payload[k]));
      if (type === 'appointments' && payload.status === 'Pago' && number(payload.discount) > number(payload.amount)) throw Error('O desconto não pode exceder o valor do serviço.');
      if (type === 'appointments') {
        const card = ['Crédito', 'Débito'].includes(payload.method);
        const base = Math.max(0, number(payload.amount) - number(payload.discount));
        const percent = card ? number(data.feePercent ?? (data.id && base > 0 ? number(data.fee) / base * 100 : 0)) : 0;
        if (percent < 0 || percent > 100) throw Error('A taxa do cartão deve estar entre 0% e 100%.');
        payload.feePercent = Math.round(percent * 10000) / 10000;
        payload.fee = card ? Math.round(base * percent) / 100 : 0;
      }
      if (type === 'expenses') {
        payload.fundSource = payload.fundSource === 'Despesas' || !payload.fundSource ? 'Barbearia' : payload.fundSource;
        if (payload.dueDate && payload.status === 'Pendente' && payload.paidAt) payload.paidAt = '';
        if (payload.status === 'Pago' && !payload.paidAt) payload.paidAt = today();
        if (isMonthly(payload) && !payload.dueDate) throw Error('Informe a data de vencimento da despesa fixa mensal.');
        // Uma despesa mensal cadastrada é a primeira parcela; as próximas são geradas quando o ERP é aberto.
        if (isMonthly(payload)) {
          payload.recurringSeriesId = data.recurringSeriesId || data.id || (globalThis.crypto?.randomUUID?.() || `serie-${Date.now()}`);
          payload.recurringMonth = data.recurringMonth || (payload.dueDate || payload.date).slice(0, 7);
          payload.recurringDay = data.recurringDay || Number(payload.dueDate.slice(8, 10));
          payload.recurringStartMonth = data.recurringStartMonth || payload.recurringMonth;
          payload.recurringActive = data.recurringActive !== false;
        } else if (data.recurringSeriesId) {
          // Editar uma parcela avulsa não apaga as outras parcelas já registradas.
          payload.recurringActive = false;
          payload.recurringSeriesId = '';
          payload.recurringMonth = '';
        }
      }
      if (data.id) { const { id, ...rest } = payload; await updateDoc(doc(db, 'erp', type, 'items', id), { ...rest, updatedAt: serverTimestamp() }); }
      else await addDoc(collection(db, 'erp', type, 'items'), { ...payload, createdAt: serverTimestamp() });
      setForm(null); setMessage('Registro salvo com sucesso.');
    } catch (err) { setMessage('Falha ao salvar: ' + err.message); } finally { setBusy(false); }
  };

  // Excluir uma parcela deixa um marcador no Firebase para impedir sua recriação.
  // Cancelar a série desativa todos os lançamentos da série, preservando o histórico.
  const remove = async (type, id) => {
    const item = list(type).find(x => x.id === id);
    if (!item) return;
    if (type === 'expenses' && item.recurringSeriesId && isMonthly(item)) {
      const choice = window.prompt('DESPESA FIXA MENSAL\n\nDigite 1 para excluir somente esta parcela.\nDigite 2 para cancelar toda a recorrência (preserva as parcelas anteriores).\n\nCancelar ou deixar em branco não altera nada.');
      if (choice === '1') {
        if (!window.confirm('Excluir somente esta parcela? Ela não será recriada automaticamente.')) return;
        try {
          await updateDoc(doc(db, 'erp', 'expenses', 'items', id), { recurringSkipped: true, updatedAt: serverTimestamp() });
          setMessage('Parcela excluída. Os próximos meses continuam normalmente.');
        } catch (e) { setMessage('Erro ao excluir parcela: ' + e.message); }
      } else if (choice === '2') {
        if (!window.confirm('Cancelar os próximos lançamentos desta despesa fixa? O histórico será mantido.')) return;
        try {
          const seriesItems = list('expenses').filter(x => x.recurringSeriesId === item.recurringSeriesId);
          await Promise.all(seriesItems.map(x => updateDoc(doc(db, 'erp', 'expenses', 'items', x.id), { recurringActive: false, updatedAt: serverTimestamp() })));
          setMessage('Recorrência cancelada. As parcelas anteriores foram preservadas.');
        } catch (e) { setMessage('Erro ao cancelar recorrência: ' + e.message); }
      }
      return;
    }
    if (!window.confirm('Excluir definitivamente este registro?')) return;
    try { await deleteDoc(doc(db, 'erp', type, 'items', id)); setMessage('Registro excluído.'); }
    catch (e) { setMessage('Erro ao excluir: ' + e.code); }
  };

  // Gera até o mês atual e nunca cria uma parcela futura além do mês corrente.
  // A chave determinística permite reexecutar sem criar duplicatas.
  const generateRecurring = async () => {
    if (!admin || !expensesLoaded || generatingRef.current) return;
    generatingRef.current = true;
    setRecurringBusy(true);
    try {
      const all = list('expenses');
      const currentMonth = today().slice(0, 7);
      const series = new Map();
      all.filter(x => isMonthly(x) && x.recurringSeriesId && x.recurringActive !== false).forEach(x => {
        const key = x.recurringSeriesId;
        const old = series.get(key);
        if (!old || (old.recurringSkipped && !x.recurringSkipped) || (!!old.recurringSkipped === !!x.recurringSkipped && (x.recurringMonth || '').localeCompare(old.recurringMonth || '') > 0)) series.set(key, x);
      });
      let count = 0;
      for (const [seriesId, template] of series) {
        const start = template.recurringStartMonth || (template.dueDate || template.date || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(start)) continue;
        let ym = monthShift(start, 1);
        let safety = 0;
        while (ym <= currentMonth && safety++ < 120) {
          const id = `rec-${seriesId}-${ym}`.replaceAll('/', '_');
          const exists = all.some(x => x.recurringSeriesId === seriesId && (x.recurringMonth || dueDate(x).slice(0, 7)) === ym);
          if (!exists && !generatedKeys.current.has(id)) {
            generatedKeys.current.add(id);
            const d = dueInMonth(ym, template.recurringDay || Number((template.dueDate || '').slice(8, 10)) || 1);
            const data = { ...template };
            delete data.id; delete data.createdAt; delete data.updatedAt;
            data.date = d; data.dueDate = d; data.paidAt = ''; data.status = 'Pendente'; data.recurringMonth = ym; data.recurringSkipped = false;
            // Transação: nunca sobrescreve um lançamento existente ou excluído.
            try { await setRecurringDoc(id, data); count++; } catch (err) { generatedKeys.current.delete(id); throw err; }
          }
          ym = monthShift(ym, 1);
        }
      }
      setMessage(count ? `${count} despesa(s) mensal(is) gerada(s).` : 'Despesas mensais já estão em dia.');
    } catch (err) { setMessage('Erro ao gerar despesas mensais: ' + err.message); }
    finally { generatingRef.current = false; setRecurringBusy(false); }
  };

  // Executa automaticamente ao abrir o ERP ou cadastrar uma nova despesa fixa.
  const recurringSignature = (records.expenses || []).filter(x => isMonthly(x) && x.recurringSeriesId && x.recurringActive !== false).map(x => x.recurringSeriesId + ':' + (x.recurringStartMonth || x.recurringMonth || '')).sort().join('|');
  useEffect(() => {
    if (admin && expensesLoaded && recurringSignature && !recurringBusy) generateRecurring();
    // O conjunto generatedKeys impede repetição enquanto o snapshot do Firestore atualiza.
  }, [admin, expensesLoaded, recurringSignature]);

  const exportCsv = kind => {
    const items = kind === 'all' ? Object.keys(defs).flatMap(k => list(k).filter(x => !x.recurringSkipped).map(x => ({ tipo: k, ...x }))) : list(kind).filter(x => !x.recurringSkipped);
    const filtered = kind === 'all' ? items : items.filter(x => !x.date || validDate(x.date));
    const keys = [...new Set(filtered.flatMap(x => Object.keys(x).filter(k => !['createdAt', 'updatedAt'].includes(k))))];
    const esc = v => '"' + String(v ?? '').replaceAll('"', '""') + '"';
    const csv = '\ufeff' + [keys.join(';'), ...filtered.map(x => keys.map(k => esc(x[k])).join(';'))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `barbearia041-${kind}-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (user === undefined || loadingAdmin) return <div className="center">Carregando Sistema…</div>;
  if (!user) return <main className="auth"><div className="authCard"><div className="upfi-brand"><img className="upfi-brand-icon" src={import.meta.env.BASE_URL + "upfi-menu-icon.png"} alt="Ícone" /><img className="upfi-brand-logo" src={import.meta.env.BASE_URL + "upfi-logo-cliente.png"} alt="Logo do cliente" /><span className="upfi-brand-name">Barbearia Premium</span></div><p className="eyebrow upfi-login-signature">Upfi Solução em Gestão Empresarial</p><h1>Bem-vindo ao sistema<br/><em>Sua gestão em um só lugar.</em></h1><p className="upfi-login-description">Entre com seu e-mail e senha para acessar.</p><form onSubmit={async e => { e.preventDefault(); setBusy(true); setMessage(''); try { await signInWithEmailAndPassword(auth, email, password); } catch (err) { setMessage('Não foi possível entrar: ' + err.code); } finally { setBusy(false); } }}><label>E-mail<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" /></label><label>Senha<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label><button className="primary" disabled={busy}>Entrar no sistema</button></form>{message && <p className="error">{message}</p>}</div></main>;
  if (!admin) return <main className="auth"><div className="authCard"><h2>Acesso restrito</h2><p>Esta conta não possui permissão de proprietário no Firebase.</p>{message && <p className="error">{message}</p>}<button onClick={() => signOut(auth)}>Sair</button></div></main>;

  return <div className="layout"><aside className="sidebar"><div className="upfi-brand"><img className="upfi-brand-icon" src={import.meta.env.BASE_URL + "upfi-menu-icon.png"} alt="Ícone" /><img className="upfi-brand-logo" src={import.meta.env.BASE_URL + "upfi-logo-cliente.png"} alt="Logo do cliente" /><span className="upfi-brand-name">Barbearia Premium</span></div><p className="eyebrow upfi-sidebar-signature">Upfi Solução em Gestão Empresarial</p><nav>{menu.map(([id, label, ico]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setForm(null); setQuery(''); }}>{label}</button>)}</nav><div className="user">Proprietário<small>{user.email}</small><button onClick={() => signOut(auth)}>Sair da conta ↗</button></div></aside><main className="content"><header className="top"><div><p className="eyebrow">BARBEARIA / ADMINISTRATIVO</p><h1>{tab === 'dashboard' ? 'Visão geral' : tab === 'reports' ? 'Relatórios' : tab === 'reserves' ? 'Reservas financeiras' : defs[tab]?.title}</h1></div><div className="tools"><label>Período <input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label></div></header>{message && <div className="notice">{message}<button onClick={() => setMessage('')}>×</button></div>}
  {(tab === 'dashboard' || tab === 'reports' || tab === 'reserves') && <section className="panel reservePanel"><div className="sectionHead"><div><h2>Distribuição financeira</h2><p>{tab === "dashboard" ? "Selecione o período para consultar o faturamento e a distribuição 40% / 40% / 20%. O saldo real acumulado permanece independente do filtro." : `Saldos reais acumulados até ${month}, incluindo despesas e ajustes.`}</p></div><button onClick={exportReserveCsv}>Exportar demonstrativo CSV ↓</button></div>{tab === 'dashboard' &&   <div className="periodSummary">
  <h3>Faturamento por período</h3>

  <div className="tableTools">
    <select
      value={periodFilter}
      onChange={e => setPeriodFilter(e.target.value)}
    >
      {periodOptions.map(([value, label]) =>
        <option key={value} value={value}>{label}</option>
      )}
    </select>

    <input
      type="date"
      value={referenceDate}
      onChange={e => setReferenceDate(e.target.value)}
    />

    <button onClick={() => {
      setReferenceDate(today());
      setPeriodFilter('today');
    }}>
      Voltar para hoje
    </button>
  </div>

  <section className="stats">
    <article>
      <small>Faturamento bruto</small>
      <strong>{money(periodGross)}</strong>
    </article>

    <article>
      <small>Faturamento líquido</small>
      <strong>{money(periodNet)}</strong>
    </article>

    <article>
      <small>Atendimentos pagos</small>
      <strong>{periodPaid.length}</strong>
    </article>

    <article>
      <small>Período consultado</small>
      <span>{periodStart.split("-").reverse().join("/")} até {periodEnd.split("-").reverse().join("/")}</span>
    </article>
  </section>
</div>}
{tab === 'dashboard' ? <div className="reserveGrid">{fundNames.map((name,i)=><article key={name}>
  <small>{name} — {[40,40,20][i]}%</small>
  <strong className="positive">{money(periodSharesCents[i]/100)}</strong>
  <span>Distribuído no período: {money(periodSharesCents[i]/100)}</span>
  <span>Despesas pagas no período: {money(periodUsedCents[i]/100)}</span>
  <span>Resultado do período: {money((periodSharesCents[i]-periodUsedCents[i])/100)}</span>
  <span>Saldo real acumulado: {money(balancesCents[i]/100)}</span>
</article>)}</div> : <div className="reserveGrid">{fundNames.map((name,i)=><article key={name}><small>{name} — {[40,40,20][i]}%</small><strong className={balancesCents[i]<0?'negative':'positive'}>{money(balancesCents[i]/100)}</strong><span>Recebido no mês: {money(monthShares[i]/100)}</span><span>Distribuído até o mês: {money(allocationCents[i]/100)}</span><span>Saldo inicial/ajustes: {money(openingCents[i]/100)}</span><span>Despesas pagas: {money(usedCents[i]/100)}</span></article>)}</div>}<p className="hint">Cada despesa paga reduz somente a reserva escolhida. Despesas anteriores sem origem registrada são atribuídas à reserva Barbearia. Receitas de “Outras receitas” não entram na divisão.</p></section>}
  {tab === 'reserves' && <section className="panel"><h2>Adicionar saldo inicial ou ajuste retroativo</h2><p>Preencha a data e os valores que já existiam em cada reserva. Esses valores não recebem uma nova distribuição de 40/40/20. Evite duplicar atendimentos já cadastrados.</p><form onSubmit={saveOpening} className="openingForm"><label>Data<input required type="date" value={opening.date} onChange={e=>setOpening({...opening,date:e.target.value})}/></label>{[['prolabore','Pró-labore'],['expenses','Barbearia'],['safety','Margem de segurança']].map(([key,label])=><label key={key}>{label} (R$)<input type="number" step="0.01" value={opening[key]} onChange={e=>setOpening({...opening,[key]:e.target.value})}/></label>)}<label>Observação<input value={opening.notes} onChange={e=>setOpening({...opening,notes:e.target.value})}/></label><button className="primary" disabled={busy}>Entrar no sistema</button></form><h2 style={{marginTop:26}}>Histórico de saldos e ajustes</h2><div className="tableWrap"><table><thead><tr><th>Data</th><th>Pró-labore</th><th>Barbearia</th><th>Segurança</th><th>Observação</th><th>Ação</th></tr></thead><tbody>{list('reserves').map(x=><tr key={x.id}><td>{x.date}</td><td>{money(x.prolabore)}</td><td>{money(x.expenses)}</td><td>{money(x.safety)}</td><td>{x.notes||'—'}</td><td><button className="linkBtn danger" onClick={()=>remove('reserves',x.id)}>Excluir</button></td></tr>)}</tbody></table></div></section>}
  {(tab === 'dashboard' || tab === 'expenses') && <section className="panel"><div className="sectionHead"><div><h2>🔔 Alertas de despesas</h2><p>Contas não pagas que venceram ou vencem nos próximos 7 dias.</p></div><button onClick={generateRecurring} disabled={recurringBusy}>{recurringBusy ? 'Gerando…' : 'Atualizar despesas mensais'}</button></div>{alerts.length ? <div>{alerts.map(x => <div className="line" key={x.id}><span><b>{expenseState(x) === 'Atrasada' ? '🔴' : '🟠'} {expenseState(x)}</b> — {x.description} • vence {dueDate(x).split('-').reverse().join('/')}</span><b>{money(x.amount)} <button className="linkBtn" onClick={() => { setTab('expenses'); setForm({ type: 'expenses', data: { ...x } }); }}>Editar / Pagar</button></b></div>)}</div> : <p className="hint">Nenhuma conta vencida ou com vencimento nos próximos 7 dias.</p>}</section>}
  {tab === 'dashboard' && <><section className="two"><div className="panel"><h2>Resumo financeiro</h2>{[['Atendimentos recebidos', gross], ['Descontos + taxas', -fees], ['Outras receitas recebidas', other], ['Despesas pagas', -spent], ['Resultado', profit]].map(([label, value]) => <div className="line" key={label}><span>{label}</span><b>{money(value)}</b></div>)}<p className="hint">Resultado gerencial de caixa. Não inclui impostos ou custos não lançados.</p></div><div className="panel"><h2>Indicadores</h2><div className="line"><span>Atendimentos no mês</span><b>{appointments.length}</b></div><div className="line"><span>Ticket médio pago</span><b>{money(paid.length ? gross / paid.length : 0)}</b></div><div className="line"><span>Estoque baixo</span><b>{list('products').filter(x => number(x.quantity) <= number(x.min)).length} produtos</b></div><div className="line"><span>Despesas pendentes</span><b>{money(exp.filter(x => x.status === 'Pendente').reduce((a, x) => a + number(x.amount), 0))}</b></div><div className="line"><span>Contas atrasadas (todos os meses)</span><b>{overdue.length}</b></div><button className="primary" onClick={() => { setTab('appointments'); resetForm('appointments'); }}>+ Registrar atendimento</button></div></section></>}

  {Object.hasOwn(defs, tab) && <section className="panel"><div className="sectionHead"><div><h2>{defs[tab].title}</h2><p>{tab === 'appointments' ? 'Registre cada atendimento e sua forma de pagamento.' : tab === 'expenses' ? 'Cadastre despesas, vencimentos e contas fixas mensais.' : 'Cadastre e atualize os registros.'}</p></div><button className="primary" onClick={() => resetForm(tab)}>+ Novo registro</button></div><div className="tableTools"><input placeholder="Buscar registros..." value={query} onChange={e => setQuery(e.target.value)} /><button onClick={() => exportCsv(tab)}>Exportar CSV ↓</button></div><div className="tableWrap"><table><thead><tr>{defs[tab].fields.slice(0, 5).map(f => <th key={f[0]}>{f[1]}</th>)}{tab === 'expenses' && <th>Alerta</th>}<th>Ações</th></tr></thead><tbody>{list(tab).filter(x => !x.recurringSkipped && (!x.date || validDate(x.date)) && JSON.stringify(x).toLowerCase().includes(query.toLowerCase())).sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(x => <tr key={x.id}>{defs[tab].fields.slice(0, 5).map(([k, , type]) => <td key={k}>{type === 'number' && ['amount', 'price', 'cost', 'fee', 'discount', 'purchaseValue', 'maintenanceCost'].includes(k) ? money(x[k]) : String(x[k] ?? '—')}</td>)}{tab === 'expenses' && <td>{expenseState(x)}</td>}<td><button className="linkBtn" onClick={() => setForm({ type: tab, data: { ...x } })}>Editar</button><button className="linkBtn danger" onClick={() => remove(tab, x.id)}>Excluir</button></td></tr>)}{list(tab).length === 0 && <tr><td colSpan="12" className="empty">Nenhum registro cadastrado ainda.</td></tr>}</tbody></table></div></section>}
  {tab === 'reports' && <><section className="stats"><article><small>Receitas líquidas recebidas</small><strong>{money(gross - fees + other)}</strong></article><article><small>Despesas pagas</small><strong>{money(spent)}</strong></article><article><small>Resultado gerencial</small><strong>{money(profit)}</strong></article><article><small>Atendimentos</small><strong>{appointments.length}</strong></article></section><section className="two"><div className="panel"><h2>Recebimentos por forma de pagamento</h2>{methods.map(m => <div className="line" key={m}><span>{m}</span><b>{money(paid.filter(x => x.method === m).reduce((a, x) => a + number(x.amount) - number(x.discount) - number(x.fee), 0) + inc.filter(x => x.method === m && x.status === 'Recebido').reduce((a, x) => a + number(x.amount), 0))}</b></div>)}</div><div className="panel"><h2>Despesas por categoria</h2>{categories.map(c => <div className="line" key={c}><span>{c}</span><b>{money(exp.filter(x => x.category === c && x.status === 'Pago').reduce((a, x) => a + number(x.amount), 0))}</b></div>)}</div></section><section className="panel"><h2>Exportar registros</h2><p>Faça uma cópia CSV dos lançamentos para conferência e arquivamento.</p><button className="primary" onClick={() => exportCsv('all')}>Exportar todos os registros ↓</button></section></>}
  <footer>Desenvolvido por UPfi Soluções em Sistemas • Faça backups regulares dos dados.</footer></main>
  {form && <div className="modalBackdrop" onClick={() => setForm(null)}><div className="modal" onClick={e => e.stopPropagation()}><div className="modalHeader"><h2>{form.data.id ? 'Editar' : 'Cadastrar'} — {defs[form.type].title}</h2><button onClick={() => setForm(null)}>×</button></div><form onSubmit={save}><div className="formGrid">{defs[form.type].fields.map(([key, label, type, required, options]) => (form.type === 'appointments' && key === 'fee' && !['Crédito','Débito'].includes(form.data.method)) ? null : <label key={key}>{label}{type === 'select' ? <select required={!!required} value={form.data[key] ?? ''} onChange={e => setForm({ ...form, data: { ...form.data, [key]: e.target.value } })}>{options.map(x => <option key={x}>{x}</option>)}</select> : <input required={!!required} type={type} min={type === 'number' ? '0' : undefined} max={form.type === 'appointments' && key === 'fee' ? '100' : undefined} step={type === 'number' ? '0.01' : undefined} value={form.type === 'appointments' && key === 'fee' ? (form.data.feePercent ?? (form.data.id && (number(form.data.amount) - number(form.data.discount)) > 0 ? (number(form.data.fee) / (number(form.data.amount) - number(form.data.discount)) * 100).toFixed(2) : '')) : (form.data[key] ?? '')} onChange={e => setForm({ ...form, data: { ...form.data, [form.type === 'appointments' && key === 'fee' ? 'feePercent' : key]: e.target.value } })} />}</label>)}</div>{form.type === 'appointments' && <div className="panel" style={{marginTop:12}}><small>Prévia do recebimento</small><div className="line"><span>Valor após desconto</span><b>{money(Math.max(0,number(form.data.amount)-number(form.data.discount)))}</b></div>{['Crédito','Débito'].includes(form.data.method) && <div className="line"><span>Taxa da maquininha ({number(form.data.feePercent ?? (form.data.id && number(form.data.amount)-number(form.data.discount)>0 ? number(form.data.fee)/(number(form.data.amount)-number(form.data.discount))*100 : 0)).toFixed(2)}%)</span><b>{money(Math.round(Math.max(0,number(form.data.amount)-number(form.data.discount))*number(form.data.feePercent ?? (form.data.id && number(form.data.amount)-number(form.data.discount)>0 ? number(form.data.fee)/(number(form.data.amount)-number(form.data.discount))*100 : 0)))/100)}</b></div>}<div className="line"><strong>Valor líquido recebido</strong><strong>{money(Math.max(0,number(form.data.amount)-number(form.data.discount)) - (['Crédito','Débito'].includes(form.data.method) ? Math.round(Math.max(0,number(form.data.amount)-number(form.data.discount))*number(form.data.feePercent ?? (form.data.id && number(form.data.amount)-number(form.data.discount)>0 ? number(form.data.fee)/(number(form.data.amount)-number(form.data.discount))*100 : 0)))/100 : 0))}</strong></div></div>}<div className="modalActions"><button type="button" onClick={() => setForm(null)}>Cancelar</button><button className="primary" disabled={busy}>Entrar no sistema</button></div></form></div></div>}</div>;
}

// Importado separadamente para preservar a configuração do Firebase existente.
async function setRecurringDoc(id, data) {
  await runTransaction(db, async tx => {
    const ref = doc(db, 'erp', 'expenses', 'items', id);
    const existing = await tx.get(ref);
    if (!existing.exists()) tx.set(ref, { ...data, createdAt: serverTimestamp() });
  });
}

createRoot(document.getElementById('root')).render(<App />);
