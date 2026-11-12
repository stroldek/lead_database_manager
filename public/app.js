const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const isLocalPreview = location.protocol === 'file:';
const STORE_KEY = 'ldm_v020_demo_store';
const TOKEN_KEY = 'ldm_admin_token';

const state = {
  demo: isLocalPreview,
  token: (() => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } })(),
  page: 'dashboard',
  leadsPage: 1,
  pageSize: 25,
  totalLeads: 0,
  search: '',
  status: '',
  quality: '',
  segmentId: '',
  leads: [],
  segments: [],
  selected: new Set(),
  health: null,
  toastTimer: null,
};

const STATUS_LABELS = {
  new: 'Новый', in_progress: 'В работе', processed: 'Обработан',
  qualified: 'Перспективный', rejected: 'Отклонён', blocked: 'Заблокирован',
};
const QUALITY_LABELS = { high: 'Высокое', medium: 'Среднее', low: 'Низкое', unclassified: 'Не задано' };
const PAGE_META = {
  dashboard: ['Обзор', 'Сводная информация о базе и последних действиях'],
  leads: ['База лидов', 'Просмотр, поиск, редактирование и массовое управление записями'],
  segments: ['Разделы базы', 'Тематическая сегментация лидов без дублирования записей'],
  activity: ['История операций', 'Журнал действий с записями и разделами'],
  telegram: ['Telegram', 'Настройка защищённого получения согласий через бота'],
};

function makeLocalId() {
  try { if (globalThis.crypto?.randomUUID) return crypto.randomUUID(); } catch { /* fallback below */ }
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
function dateOnly(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(date);
}
function number(value) { return Number(value || 0).toLocaleString('ru-RU'); }
function statusPill(value) {
  const map = { new: 'blue', in_progress: 'yellow', processed: 'green', qualified: 'green', rejected: 'red', blocked: 'red' };
  return `<span class="pill ${map[value] || 'gray'}">${escapeHtml(STATUS_LABELS[value] || value || '—')}</span>`;
}
function qualityPill(value) {
  const map = { high: 'green', medium: 'yellow', low: 'red', unclassified: 'gray' };
  return `<span class="pill ${map[value] || 'gray'}">${escapeHtml(QUALITY_LABELS[value] || value || '—')}</span>`;
}
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}
function setAuthMessage(message, isError = true) {
  const node = $('#auth-message');
  node.textContent = message || '';
  node.style.color = isError ? 'var(--red)' : 'var(--green)';
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (state.token) headers.set('X-Admin-Token', state.token);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  let data;
  try { data = await response.json(); } catch { throw new Error(`Сервер вернул некорректный ответ (${response.status}).`); }
  if (!response.ok || data.ok === false) {
    if (response.status === 401 && !path.endsWith('/auth/verify')) logout(false);
    const errors = {
      database_not_configured: 'К Worker ещё не подключена база D1.',
      database_not_ready: 'Схема базы не подготовлена. Примените SQL-миграции из ZIP.',
      admin_token_not_configured: 'В Cloudflare не задан секрет ADMIN_TOKEN.',
      unauthorized: 'Ключ доступа недействителен. Войдите повторно.',
      invalid_telegram_id: 'Telegram ID должен содержать только цифры.',
      telegram_id_already_exists: 'Такой Telegram ID уже есть в базе.',
      segment_name_exists: 'Раздел с таким названием уже существует.',
    };
    throw new Error(errors[data.error] || data.error || `Ошибка запроса (${response.status}).`);
  }
  return data;
}

function seedDemoStore() {
  const now = Date.now();
  const d = (days) => new Date(now - days * 86400000).toISOString();
  return {
    segments: [
      { id: 'seg-unprocessed', name: 'Необработанные', description: 'Лиды, которые ещё не прошли первичную обработку.', color: '#78A9C8', created_at: d(90) },
      { id: 'seg-promising', name: 'Перспективные', description: 'Лиды, требующие дальнейшей проработки.', color: '#77B99A', created_at: d(70) },
      { id: 'seg-mobile', name: 'Мобильные аксессуары', description: 'Лиды по направлению мобильных аксессуаров.', color: '#D8B777', created_at: d(60) },
      { id: 'seg-electronics', name: 'Электроника', description: 'Лиды по направлению электроники.', color: '#AA9BD4', created_at: d(50) },
    ],
    leads: [
      ['100000001','alex_mobile','Александр','Коваленко','telegram_bot','high','qualified',['seg-mobile','seg-promising'],2],
      ['100000002','tech_import','Ирина','Шевченко','manual','medium','in_progress',['seg-electronics'],4],
      ['100000003','gadget_lab','Дмитрий','Мельник','telegram_bot','high','new',['seg-mobile','seg-unprocessed'],1],
      ['100000004','smart_home_ua','Олег','Бондарь','manual','low','rejected',['seg-electronics'],9],
      ['100000005','accessory_pro','Марина','Ткаченко','telegram_bot','medium','processed',['seg-mobile'],12],
      ['100000006','digital_market','Владислав','Романенко','manual','unclassified','new',['seg-unprocessed'],0],
      ['100000007','device_import','Наталья','Лисенко','telegram_bot','high','in_progress',['seg-electronics','seg-promising'],3],
      ['100000008','power_supply','Андрей','Мороз','manual','medium','new',['seg-mobile','seg-unprocessed'],0],
      ['100000009','home_tech','Екатерина','Савченко','telegram_bot','low','blocked',[],17],
      ['100000010','wireless_ua','Сергей','Петренко','manual','high','qualified',['seg-mobile','seg-promising'],5],
      ['100000011','sound_import','Татьяна','Кравченко','telegram_bot','medium','processed',['seg-electronics'],22],
      ['100000012','smart_gadgets','Максим','Бойко','manual','unclassified','new',['seg-unprocessed'],1],
    ].map((row, index) => ({
      id: `demo-lead-${index + 1}`, telegram_id: row[0], username: row[1], first_name: row[2], last_name: row[3],
      source: row[4], quality: row[5], status: row[6], segments: row[7], consent_status: row[4] === 'telegram_bot' ? 'granted' : 'none',
      notes: '', created_at: d(row[8]), updated_at: d(Math.max(0, row[8] - 1)),
    })),
    activity: [
      { id: 'a1', action: 'lead.created', description: 'Добавлен тестовый лид 100000001', created_at: d(1) },
      { id: 'a2', action: 'segment.updated', description: 'Обновлён раздел «Мобильные аксессуары»', created_at: d(2) },
      { id: 'a3', action: 'lead.updated', description: 'Изменён статус тестового лида', created_at: d(3) },
    ],
  };
}
let demoStore = null;
function demoLoad() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    demoStore = saved ? JSON.parse(saved) : seedDemoStore();
  } catch { demoStore = seedDemoStore(); }
  demoSave();
}
function demoSave() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(demoStore)); } catch { /* browser may disable file storage */ }
}
function demoLog(description, action = 'record.updated') {
  demoStore.activity.unshift({ id: makeLocalId(), action, description, created_at: new Date().toISOString() });
  demoStore.activity = demoStore.activity.slice(0, 100);
  demoSave();
}
function demoDashboard() {
  const leads = demoStore.leads;
  const countBy = (field, value) => leads.filter((lead) => lead[field] === value).length;
  return {
    totals: { leads: leads.length, segments: demoStore.segments.length, new: countBy('status', 'new'), processed: leads.filter((l) => ['processed','qualified'].includes(l.status)).length },
    by_quality: ['high','medium','low','unclassified'].map((quality) => ({ quality, total: countBy('quality', quality) })),
    recent_activity: demoStore.activity.slice(0, 8),
    top_segments: demoStore.segments.map((segment) => ({ ...segment, leads_count: leads.filter((lead) => lead.segments.includes(segment.id)).length })).sort((a,b) => b.leads_count - a.leads_count).slice(0,8),
  };
}
function demoListLeads() {
  let items = [...demoStore.leads];
  const q = state.search.trim().toLowerCase();
  if (q) items = items.filter((lead) => [lead.telegram_id,lead.username,lead.first_name,lead.last_name,lead.source].some((v) => String(v || '').toLowerCase().includes(q)));
  if (state.status) items = items.filter((lead) => lead.status === state.status);
  if (state.quality) items = items.filter((lead) => lead.quality === state.quality);
  if (state.segmentId) items = items.filter((lead) => lead.segments.includes(state.segmentId));
  const total = items.length;
  const start = (state.leadsPage - 1) * state.pageSize;
  items = items.slice(start, start + state.pageSize).map((lead) => ({ ...lead, segments: lead.segments.map((id) => demoStore.segments.find((s) => s.id === id)?.name).filter(Boolean) }));
  return { items, pagination: { page: state.leadsPage, page_size: state.pageSize, total, pages: Math.max(1, Math.ceil(total / state.pageSize)) } };
}
function demoGetLead(id) {
  const lead = demoStore.leads.find((item) => item.id === id);
  if (!lead) return null;
  return { ...lead, segments: demoStore.segments.filter((segment) => lead.segments.includes(segment.id)) };
}
function demoCreateLead(data) {
  const existing = demoStore.leads.find((l) => l.telegram_id === data.telegram_id);
  const now = new Date().toISOString();
  if (existing) {
    Object.assign(existing, data, { updated_at: now });
    demoLog(`Обновлён лид с Telegram ID ${data.telegram_id}`, 'lead.updated');
    return { item: existing, action: 'updated' };
  }
  const item = { id: makeLocalId(), ...data, consent_status: 'none', segments: [], created_at: now, updated_at: now };
  demoStore.leads.unshift(item);
  demoLog(`Добавлен лид с Telegram ID ${data.telegram_id}`, 'lead.created');
  return { item, action: 'created' };
}
function demoSetLeadSegments(leadId, selectedIds) {
  const lead = demoStore.leads.find((l) => l.id === leadId);
  if (!lead) return;
  lead.segments = selectedIds;
  lead.updated_at = new Date().toISOString();
  demoLog('Изменена принадлежность лида к разделам', 'segment.members.updated');
}
function demoSegmentCreate(data) {
  const item = { id: makeLocalId(), ...data, created_at: new Date().toISOString() };
  demoStore.segments.push(item);
  demoLog(`Создан раздел «${item.name}»`, 'segment.created');
  return item;
}

async function authenticateLive() {
  $('#auth-screen').classList.remove('hidden');
  $('#app-shell').classList.add('hidden');
  try {
    const config = await fetch('/api/auth/config', { cache: 'no-store' }).then((r) => r.json());
    if (!config.admin_token_configured) {
      setAuthMessage('Секрет ADMIN_TOKEN ещё не добавлен в Cloudflare Worker → Settings → Variables and Secrets.');
    }
  } catch { setAuthMessage('Не удалось связаться с Worker. Проверьте публикацию.'); }
  if (state.token) {
    try {
      await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: state.token }) }).then(async (r) => {
        const data = await r.json(); if (!r.ok || !data.ok) throw new Error('invalid');
      });
      enterApp();
    } catch { sessionStorage.removeItem(TOKEN_KEY); state.token = ''; }
  }
}
function enterApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  $('#environment-label').textContent = state.demo ? 'Локальные демо-данные' : 'Cloudflare D1';
  $('#mode-badge').classList.toggle('demo', state.demo);
  $('#mode-badge').innerHTML = `<i></i> ${state.demo ? 'DEMO MODE' : 'LIVE'}`;
  if (state.demo) {
    demoLoad();
    $('#sidebar-db-label').textContent = 'Локальная демо-база';
    $('#sidebar-db-dot').className = 'status-dot';
    $('#sidebar-db-dot').style.background = 'var(--yellow)';
  }
  navigate('dashboard');
  refreshHealth();
}
function logout(showMessage = true) {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* session storage can be disabled */ }
  state.token = '';
  if (!state.demo) {
    $('#app-shell').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
    if (showMessage) setAuthMessage('Сессия завершена. Введите ключ доступа снова.');
  }
}

async function refreshHealth() {
  if (state.demo) return;
  try {
    const data = await fetch('/api/health', { cache: 'no-store' }).then((r) => r.json());
    state.health = data;
    const connected = data.checks?.database === 'connected';
    $('#sidebar-db-label').textContent = connected ? 'D1 подключена' : 'D1 не настроена';
    $('#sidebar-db-dot').className = `status-dot ${connected ? 'ok' : 'bad'}`;
    $('#nav-leads-count').textContent = data.leads_count == null ? '—' : number(data.leads_count);
  } catch {
    $('#sidebar-db-label').textContent = 'Нет связи с Worker';
    $('#sidebar-db-dot').className = 'status-dot bad';
  }
}

function navigate(page) {
  state.page = PAGE_META[page] ? page : 'dashboard';
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === state.page));
  const [title, subtitle] = PAGE_META[state.page];
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = subtitle;
  $('#top-add-lead').classList.toggle('hidden', !['dashboard','leads'].includes(state.page));
  if (state.page === 'dashboard') loadDashboard();
  if (state.page === 'leads') loadLeads();
  if (state.page === 'segments') loadSegments();
  if (state.page === 'activity') loadActivity();
  if (state.page === 'telegram') renderTelegram();
}

async function loadDashboard() {
  $('#page-content').innerHTML = '<div class="loading-state">Загружаем сводные данные…</div>';
  try {
    const data = state.demo ? demoDashboard() : await api('/api/dashboard');
    renderDashboard(data);
    if (!state.demo) $('#nav-leads-count').textContent = number(data.totals.leads);
  } catch (error) { renderError(error.message); }
}
function renderDashboard(data) {
  const totals = data.totals || {};
  const quality = data.by_quality || [];
  const qualityLabels = { high: 'Высокое качество', medium: 'Среднее качество', low: 'Низкое качество', unclassified: 'Не классифицировано' };
  const maxQuality = Math.max(1, ...quality.map((q) => Number(q.total)));
  $('#page-content').innerHTML = `
    ${state.demo ? '<div class="demo-notice"><strong>DEMO MODE</strong><span>Это тестовые записи в локальном браузере. Они не попадут в настоящую Cloudflare D1.</span></div>' : ''}
    <section class="grid kpi-grid">
      <article class="card kpi-card"><span class="kpi-icon">▤</span><div class="kpi-label">Всего лидов</div><div class="kpi-value">${number(totals.leads)}</div><div class="kpi-foot">Центральная база пользователей</div></article>
      <article class="card kpi-card"><span class="kpi-icon">✳</span><div class="kpi-label">Новые</div><div class="kpi-value">${number(totals.new)}</div><div class="kpi-foot">Ожидают первичной обработки</div></article>
      <article class="card kpi-card"><span class="kpi-icon">✓</span><div class="kpi-label">Обработаны / перспективные</div><div class="kpi-value">${number(totals.processed)}</div><div class="kpi-foot">Завершённая или успешная обработка</div></article>
      <article class="card kpi-card"><span class="kpi-icon">▦</span><div class="kpi-label">Разделов базы</div><div class="kpi-value">${number(totals.segments)}</div><div class="kpi-foot">Логические группы без копирования лидов</div></article>
    </section>
    <section class="grid split-grid">
      <article class="card panel"><div class="panel-head"><div><div class="panel-eyebrow">СЕГМЕНТАЦИЯ</div><h2>Разделы базы</h2><p>Распределение записей по тематическим группам</p></div><button class="button quiet small" data-action="goto-segments">Все разделы →</button></div>
        <div class="segment-list">${(data.top_segments || []).length ? data.top_segments.map((s) => `<div class="segment-row"><span class="segment-color" style="background:${safeColor(s.color)}"></span><div class="segment-row-main"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.description || 'Без описания')}</small></div><span class="segment-count">${number(s.leads_count)}</span></div>`).join('') : '<div class="empty-state"><strong>Разделов пока нет</strong><p>Создайте первый раздел для сегментации базы.</p><button class="button primary small" data-action="goto-segments">Создать раздел</button></div>'}</div>
      </article>
      <article class="card panel"><div class="panel-head"><div><div class="panel-eyebrow">КАЧЕСТВО БАЗЫ</div><h2>По качеству</h2><p>Распределение лидов по оценке</p></div></div>
        <div class="quality-list">${quality.map((q) => `<div class="quality-item"><div class="quality-line"><span>${qualityLabels[q.quality] || escapeHtml(q.quality)}</span><strong>${number(q.total)}</strong></div><div class="quality-track"><i style="width:${Math.round((Number(q.total)/maxQuality)*100)}%"></i></div></div>`).join('') || '<div class="empty-state">Нет данных</div>'}</div>
      </article>
    </section>
    <section class="card panel" style="margin-top:16px"><div class="panel-head"><div><div class="panel-eyebrow">ПОСЛЕДНИЕ СОБЫТИЯ</div><h2>История операций</h2><p>Недавние изменения в системе</p></div><button class="button quiet small" data-action="goto-activity">Вся история →</button></div>
      <div class="activity-list">${(data.recent_activity || []).length ? data.recent_activity.map(renderActivityRow).join('') : '<div class="empty-state"><strong>Операций пока нет</strong><p>Здесь появятся события при работе с базой.</p></div>'}</div>
    </section>`;
}
function safeColor(color) { return /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? color : '#78A9C8'; }
function renderActivityRow(item) {
  const mark = String(item.action || '').includes('delete') ? '−' : String(item.action || '').includes('create') ? '+' : '↻';
  return `<div class="activity-row"><div class="activity-mark">${mark}</div><div class="activity-body"><p>${escapeHtml(item.description || item.action || 'Операция')}</p><time>${dateLabel(item.created_at)}</time></div></div>`;
}
function renderError(message) {
  $('#page-content').innerHTML = `<div class="card empty-state"><div class="empty-icon">!</div><strong>Не удалось загрузить данные</strong><p>${escapeHtml(message)}</p><button class="button quiet small" data-action="retry">Повторить</button></div>`;
}

async function loadLeads() {
  $('#page-content').innerHTML = '<div class="loading-state">Загружаем базу лидов…</div>';
  try {
    if (!state.demo) {
      const segmentData = await api('/api/segments');
      state.segments = segmentData.items;
    } else state.segments = demoStore.segments;
    const params = new URLSearchParams({ page: String(state.leadsPage), page_size: String(state.pageSize) });
    if (state.search) params.set('q', state.search);
    if (state.status) params.set('status', state.status);
    if (state.quality) params.set('quality', state.quality);
    if (state.segmentId) params.set('segment_id', state.segmentId);
    const data = state.demo ? demoListLeads() : await api(`/api/leads?${params.toString()}`);
    state.leads = data.items;
    state.totalLeads = data.pagination.total;
    renderLeads(data);
    $('#nav-leads-count').textContent = number(state.demo ? demoStore.leads.length : data.pagination.total);
  } catch (error) { renderError(error.message); }
}
function renderLeads(data) {
  const items = data.items || [];
  const page = data.pagination.page;
  const pages = data.pagination.pages;
  const selected = state.selected.size;
  $('#page-content').innerHTML = `
    <div class="toolbar"><div class="toolbar-left"><div class="search-box"><input id="lead-search" class="field" type="search" placeholder="ID, username, имя или источник…" value="${escapeHtml(state.search)}"></div>
      <select id="lead-status-filter" class="field filter-select"><option value="">Все статусы</option>${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}" ${state.status===v?'selected':''}>${l}</option>`).join('')}</select>
      <select id="lead-quality-filter" class="field filter-select"><option value="">Любое качество</option>${Object.entries(QUALITY_LABELS).map(([v,l]) => `<option value="${v}" ${state.quality===v?'selected':''}>${l}</option>`).join('')}</select>
      <select id="lead-segment-filter" class="field filter-select"><option value="">Все разделы</option>${state.segments.map((s) => `<option value="${escapeHtml(s.id)}" ${state.segmentId===s.id?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}</select>
    </div><div class="toolbar-right"><select id="page-size" class="field filter-select" aria-label="Количество строк"><option value="25" ${state.pageSize===25?'selected':''}>25 на странице</option><option value="50" ${state.pageSize===50?'selected':''}>50 на странице</option><option value="100" ${state.pageSize===100?'selected':''}>100 на странице</option></select><button class="button primary" data-action="add-lead">＋ Добавить лида</button></div></div>
    ${selected ? `<div class="bulk-bar"><strong>Выбрано: ${selected}</strong><select id="bulk-action"><option value="">Массовое действие…</option><option value="status:new">Статус: Новый</option><option value="status:in_progress">Статус: В работе</option><option value="status:processed">Статус: Обработан</option><option value="quality:high">Качество: Высокое</option><option value="quality:medium">Качество: Среднее</option><option value="quality:low">Качество: Низкое</option><option value="quality:unclassified">Качество: Не задано</option><option value="add_segment">Добавить в раздел…</option><option value="remove_segment">Убрать из раздела…</option><option value="delete">Удалить выбранные</option></select><select id="bulk-segment"><option value="">Выберите раздел…</option>${state.segments.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('')}</select><button class="button small" data-action="apply-bulk">Применить</button><button class="button quiet small" data-action="clear-selection">Снять выделение</button></div>` : ''}
    <div class="table-wrap"><table><thead><tr><th><input type="checkbox" class="row-check" id="select-all" aria-label="Выбрать все на странице"></th><th>Telegram / Имя</th><th>Источник</th><th>Качество</th><th>Статус</th><th>Разделы</th><th>Добавлен</th><th></th></tr></thead><tbody>
      ${items.length ? items.map((lead) => `<tr><td><input type="checkbox" class="row-check lead-select" data-id="${escapeHtml(lead.id)}" ${state.selected.has(lead.id)?'checked':''}></td><td><span class="lead-id">${escapeHtml(lead.first_name || '')} ${escapeHtml(lead.last_name || '')}</span><span class="lead-name">${lead.username ? '@'+escapeHtml(lead.username) : '<span class="text-mono">ID '+escapeHtml(lead.telegram_id)+'</span>'}</span></td><td>${escapeHtml(lead.source || '—')}</td><td>${qualityPill(lead.quality)}</td><td>${statusPill(lead.status)}</td><td><div class="table-tags">${(lead.segments || []).slice(0,2).map((name) => `<span class="tag-mini">${escapeHtml(name)}</span>`).join('')}${(lead.segments || []).length>2?`<span class="tag-mini">+${lead.segments.length-2}</span>`:''}</div></td><td>${dateOnly(lead.created_at)}</td><td><div class="row-actions"><button data-action="edit-lead" data-id="${escapeHtml(lead.id)}">Открыть</button></div></td></tr>`).join('') : `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">⌕</div><strong>${state.totalLeads ? 'Ничего не найдено' : 'База пока пустая'}</strong><p>${state.totalLeads ? 'Измените параметры поиска или фильтры.' : 'Добавьте первую запись вручную или подключите Telegram-бота.'}</p><button class="button primary small" data-action="add-lead">Добавить лида</button></div></td></tr>`}
    </tbody></table></div>
    <div class="table-footer"><span>Показано ${items.length ? (page-1)*state.pageSize+1 : 0}–${Math.min(page*state.pageSize, data.pagination.total)} из ${number(data.pagination.total)}</span><div class="pagination"><button data-action="page-prev" ${page<=1?'disabled':''}>←</button><strong>Страница ${page} из ${pages}</strong><button data-action="page-next" ${page>=pages?'disabled':''}>→</button></div></div>`;
  $('#select-all').checked = items.length > 0 && items.every((lead) => state.selected.has(lead.id));
}

async function openLeadModal(id = null) {
  let lead = null;
  if (id) {
    try { lead = state.demo ? demoGetLead(id) : (await api(`/api/leads/${encodeURIComponent(id)}`)).item; }
    catch (error) { showToast(error.message); return; }
  }
  const segmentIds = new Set((lead?.segments || []).map((s) => typeof s === 'string' ? s : s.id));
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="lead-modal-title"><div class="modal-head"><div><div class="panel-eyebrow">КАРТОЧКА ЛИДА</div><h2 id="lead-modal-title">${lead ? 'Редактировать лида' : 'Новая запись'}</h2></div><button class="close-button" data-action="close-modal">×</button></div>
    <form id="lead-form"><div class="modal-body"><input type="hidden" name="id" value="${escapeHtml(lead?.id || '')}"><div class="form-grid">
      <div class="form-field"><label for="f-telegram-id">Telegram ID *</label><input id="f-telegram-id" name="telegram_id" inputmode="numeric" pattern="[0-9]+" maxlength="20" required value="${escapeHtml(lead?.telegram_id || '')}" placeholder="Например, 123456789"></div>
      <div class="form-field"><label for="f-username">Username</label><input id="f-username" name="username" maxlength="64" value="${escapeHtml(lead?.username || '')}" placeholder="username без @"></div>
      <div class="form-field"><label for="f-first-name">Имя</label><input id="f-first-name" name="first_name" maxlength="128" value="${escapeHtml(lead?.first_name || '')}"></div>
      <div class="form-field"><label for="f-last-name">Фамилия</label><input id="f-last-name" name="last_name" maxlength="128" value="${escapeHtml(lead?.last_name || '')}"></div>
      <div class="form-field"><label for="f-source">Источник</label><input id="f-source" name="source" maxlength="120" value="${escapeHtml(lead?.source || 'manual')}"></div>
      <div class="form-field"><label for="f-quality">Качество</label><select id="f-quality" name="quality">${Object.entries(QUALITY_LABELS).map(([v,l]) => `<option value="${v}" ${(lead?.quality||'unclassified')===v?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="form-field"><label for="f-status">Статус</label><select id="f-status" name="status">${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}" ${(lead?.status||'new')===v?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="form-field full-width"><label>Разделы</label><div class="check-list">${state.segments.map((s) => `<label class="check-chip"><input type="checkbox" name="segments" value="${escapeHtml(s.id)}" ${segmentIds.has(s.id)?'checked':''}><span>${escapeHtml(s.name)}</span></label>`).join('') || '<span class="muted">Пока нет созданных разделов.</span>'}</div></div>
      <div class="form-field full-width"><label for="f-notes">Заметка</label><textarea id="f-notes" name="notes" maxlength="4000" placeholder="Дополнительная информация о лиде…">${escapeHtml(lead?.notes || '')}</textarea></div>
      </div></div><div class="modal-foot">${lead ? '<button type="button" class="button danger small" data-action="delete-lead" data-id="'+escapeHtml(lead.id)+'">Удалить запись</button>' : '<span class="muted" style="font-size:10px">* Обязательное поле</span>'}<div class="right"><button type="button" class="button quiet" data-action="close-modal">Отмена</button><button type="submit" class="button primary">Сохранить</button></div></div></form></section></div>`;
}
async function saveLeadForm(form) {
  const formData = new FormData(form);
  const id = String(formData.get('id') || '');
  const data = {
    telegram_id: String(formData.get('telegram_id') || '').trim(),
    username: String(formData.get('username') || '').trim().replace(/^@/, '') || null,
    first_name: String(formData.get('first_name') || '').trim() || null,
    last_name: String(formData.get('last_name') || '').trim() || null,
    source: String(formData.get('source') || '').trim() || 'manual',
    quality: String(formData.get('quality') || 'unclassified'),
    status: String(formData.get('status') || 'new'),
    notes: String(formData.get('notes') || '').trim() || null,
  };
  const selectedSegments = $$('input[name="segments"]:checked', form).map((input) => input.value);
  if (!/^\d{1,20}$/.test(data.telegram_id) || /^0+$/.test(data.telegram_id)) { showToast('Проверьте Telegram ID: нужны только цифры.'); return; }
  let saved;
  if (state.demo) {
    const result = demoCreateLead(data);
    saved = result.item;
    demoSetLeadSegments(saved.id, selectedSegments);
  } else {
    const result = id
      ? await api(`/api/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) })
      : await api('/api/leads', { method: 'POST', body: JSON.stringify(data) });
    saved = result.item;
    const previousIds = new Set((saved.segments || []).map((s) => s.id));
    const added = selectedSegments.filter((segmentId) => !previousIds.has(segmentId));
    const removed = [...previousIds].filter((segmentId) => !selectedSegments.includes(segmentId));
    for (const segmentId of added) await api(`/api/segments/${encodeURIComponent(segmentId)}/members`, { method: 'POST', body: JSON.stringify({ operation: 'add', lead_ids: [saved.id] }) });
    for (const segmentId of removed) await api(`/api/segments/${encodeURIComponent(segmentId)}/members`, { method: 'POST', body: JSON.stringify({ operation: 'remove', lead_ids: [saved.id] }) });
  }
  $('#modal-root').innerHTML = '';
  state.selected.clear();
  showToast(id ? 'Изменения лида сохранены.' : 'Лид добавлен в базу.');
  if (state.page === 'leads') await loadLeads(); else await loadDashboard();
}
async function deleteLead(id) {
  if (!confirm('Удалить лида из центральной базы? Это действие нельзя отменить.')) return;
  if (state.demo) {
    demoStore.leads = demoStore.leads.filter((l) => l.id !== id);
    demoStore.segments.forEach((s) => {});
    demoLog('Удалена демо-запись лида', 'lead.deleted');
  } else await api(`/api/leads/${encodeURIComponent(id)}`, { method: 'DELETE' });
  $('#modal-root').innerHTML = '';
  state.selected.delete(id);
  showToast('Запись удалена.');
  if (state.page === 'leads') await loadLeads(); else await loadDashboard();
}

async function loadSegments() {
  $('#page-content').innerHTML = '<div class="loading-state">Загружаем разделы…</div>';
  try {
    const items = state.demo
      ? demoStore.segments.map((s) => ({ ...s, leads_count: demoStore.leads.filter((l) => l.segments.includes(s.id)).length }))
      : (await api('/api/segments')).items;
    state.segments = items;
    renderSegments(items);
  } catch (error) { renderError(error.message); }
}
function renderSegments(items) {
  $('#page-content').innerHTML = `<div class="toolbar"><div class="toolbar-left"><div><div class="panel-eyebrow">ЛОГИЧЕСКИЕ ГРУППЫ</div><div class="muted" style="font-size:11px;margin-top:4px">Один лид может находиться сразу в нескольких разделах.</div></div></div><div class="toolbar-right"><button class="button primary" data-action="add-segment">＋ Создать раздел</button></div></div>
    <div class="grid segment-card-grid">${items.length ? items.map((s) => `<article class="card segment-card"><div class="segment-card-head"><div><span class="segment-color" style="background:${safeColor(s.color)};display:block;width:28px;height:5px;margin-bottom:11px"></span><h3>${escapeHtml(s.name)}</h3></div><div class="row-actions"><button data-action="edit-segment" data-id="${escapeHtml(s.id)}">Изменить</button></div></div><p>${escapeHtml(s.description || 'Нет описания')}</p><div class="segment-card-foot"><div><strong>${number(s.leads_count)}</strong><span> лидов</span></div><button class="button quiet small" data-action="open-segment-leads" data-id="${escapeHtml(s.id)}">Открыть базу →</button></div></article>`).join('') : `<div class="card empty-state"><strong>Разделы не созданы</strong><p>Создайте первый раздел для группировки лидов.</p></div>`}</div>
    <div class="notice" style="margin-top:17px"><span class="notice-mark">i</span><p>Удаление раздела не удаляет лидов из основной базы. Удаляется только связь между разделом и записями.</p></div>`;
}
async function openSegmentModal(id = null) {
  const segment = id ? state.segments.find((s) => s.id === id) : null;
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="panel-eyebrow">СЕГМЕНТАЦИЯ</div><h2>${segment ? 'Редактировать раздел' : 'Новый раздел'}</h2></div><button class="close-button" data-action="close-modal">×</button></div><form id="segment-form"><div class="modal-body"><input type="hidden" name="id" value="${escapeHtml(segment?.id || '')}"><div class="form-grid"><div class="form-field full-width"><label for="segment-name">Название *</label><input id="segment-name" name="name" maxlength="80" required value="${escapeHtml(segment?.name || '')}" placeholder="Например, Мобильные аксессуары"></div><div class="form-field full-width"><label for="segment-description">Описание</label><textarea id="segment-description" name="description" maxlength="500">${escapeHtml(segment?.description || '')}</textarea></div><div class="form-field"><label for="segment-color">Цвет раздела</label><input id="segment-color" name="color" type="color" value="${safeColor(segment?.color || '#78A9C8')}" style="height:39px;padding:4px"></div></div></div><div class="modal-foot">${segment ? `<button type="button" class="button danger small" data-action="delete-segment" data-id="${escapeHtml(segment.id)}">Удалить раздел</button>` : '<span></span>'}<div class="right"><button type="button" class="button quiet" data-action="close-modal">Отмена</button><button class="button primary" type="submit">Сохранить</button></div></div></form></section></div>`;
}
async function saveSegmentForm(form) {
  const fd = new FormData(form);
  const id = String(fd.get('id') || '');
  const data = { name: String(fd.get('name') || '').trim(), description: String(fd.get('description') || '').trim(), color: String(fd.get('color') || '#78A9C8') };
  if (!data.name) { showToast('Введите название раздела.'); return; }
  if (state.demo) {
    if (id) Object.assign(demoStore.segments.find((s) => s.id === id), data);
    else demoSegmentCreate(data);
    demoSave();
  } else {
    await api(id ? `/api/segments/${encodeURIComponent(id)}` : '/api/segments', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) });
  }
  $('#modal-root').innerHTML = '';
  showToast(id ? 'Раздел обновлён.' : 'Раздел создан.');
  await loadSegments();
}
async function deleteSegment(id) {
  const segment = state.segments.find((s) => s.id === id);
  if (!confirm(`Удалить раздел «${segment?.name || ''}»? Лиды останутся в базе.`)) return;
  if (state.demo) {
    demoStore.segments = demoStore.segments.filter((s) => s.id !== id);
    demoStore.leads.forEach((l) => { l.segments = l.segments.filter((segmentId) => segmentId !== id); });
    demoLog(`Удалён раздел «${segment?.name || ''}». Лиды сохранены.`, 'segment.deleted');
  } else await api(`/api/segments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  $('#modal-root').innerHTML = '';
  showToast('Раздел удалён. Лиды сохранены.');
  await loadSegments();
}

async function applyBulk() {
  const actionValue = $('#bulk-action')?.value;
  if (!actionValue) { showToast('Выберите массовое действие.'); return; }
  const ids = [...state.selected];
  if (!ids.length) return;
  if (actionValue === 'delete' && !confirm(`Удалить ${ids.length} выбранных записей? Это действие нельзя отменить.`)) return;
  const [action, value] = actionValue.split(':');
  const body = { ids };
  if (['status','quality'].includes(action)) { body.action = action; body.value = value; }
  else if (action === 'add_segment' || action === 'remove_segment') {
    const segmentId = $('#bulk-segment').value;
    if (!segmentId) { showToast('Выберите раздел.'); return; }
    body.action = action; body.segment_id = segmentId;
  } else body.action = action;
  try {
    if (state.demo) {
      for (const id of ids) {
        const lead = demoStore.leads.find((l) => l.id === id);
        if (!lead) continue;
        if (action === 'delete') demoStore.leads = demoStore.leads.filter((l) => l.id !== id);
        if (action === 'status') lead.status = value;
        if (action === 'quality') lead.quality = value;
        if (action === 'add_segment' && !lead.segments.includes(body.segment_id)) lead.segments.push(body.segment_id);
        if (action === 'remove_segment') lead.segments = lead.segments.filter((sid) => sid !== body.segment_id);
      }
      demoLog(`Массовая операция ${action}; записей: ${ids.length}`, `leads.bulk.${action}`);
    } else await api('/api/leads/bulk', { method: 'POST', body: JSON.stringify(body) });
    state.selected.clear(); showToast(`Обработано записей: ${ids.length}`); await loadLeads();
  } catch (error) { showToast(error.message); }
}

async function loadActivity() {
  $('#page-content').innerHTML = '<div class="loading-state">Загружаем журнал…</div>';
  try {
    const items = state.demo ? demoStore.activity : (await api('/api/activity')).items;
    $('#page-content').innerHTML = `<section class="card panel"><div class="panel-head"><div><div class="panel-eyebrow">AUDIT LOG</div><h2>Все операции</h2><p>События, зафиксированные системой</p></div><span class="pill gray">${number(items.length)} событий</span></div><div class="activity-list">${items.length ? items.map(renderActivityRow).join('') : '<div class="empty-state"><strong>История пока пуста</strong><p>Изменения базы будут отображаться здесь.</p></div>'}</div></section>`;
  } catch (error) { renderError(error.message); }
}
function renderTelegram() {
  $('#page-content').innerHTML = `<div class="grid telegram-layout"><section class="card telegram-card"><div class="panel-eyebrow">TELEGRAM BOT API</div><h2>Регистрация webhook</h2><p>Этот модуль принимает сообщения от пользователей, которые самостоятельно открыли вашего бота. Новый профиль сохраняется только после явного согласия через кнопку в Telegram.</p><div class="telegram-step"><div class="step-number">1</div><div><strong>Добавьте секреты в Cloudflare</strong><small>TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и SETUP_TOKEN. Секреты не должны попадать в GitHub или frontend.</small></div></div><div class="telegram-step"><div class="step-number">2</div><div><strong>Зарегистрируйте webhook</strong><small>Worker проверит бота через getMe и привяжет endpoint к текущему адресу приложения.</small></div></div><div class="telegram-step"><div class="step-number">3</div><div><strong>Проверьте согласие</strong><small>Откройте бота, отправьте /start и выберите «Согласен». Отзыв согласия — команда /stop.</small></div></div><div class="notice"><span class="notice-mark">!</span><p>Не используйте модуль для произвольного поиска пользователей или нежелательной рассылки. Бот не может первым начать личный диалог.</p></div></section><section class="card telegram-card"><div class="panel-eyebrow">НАСТРОЙКА СОЕДИНЕНИЯ</div><h2>Подключить бота</h2><form id="webhook-form"><div class="form-field"><label for="setup-token">SETUP_TOKEN</label><input id="setup-token" type="password" autocomplete="off" placeholder="Ключ настройки из Cloudflare" required></div><button class="button primary full" style="margin-top:12px" type="submit">Зарегистрировать webhook</button></form><div id="webhook-result" class="inline-message" style="margin-top:12px" aria-live="polite"></div><div class="panel-eyebrow" style="margin-top:26px">СТАТУС</div><div class="segment-list" style="margin-top:10px"><div class="segment-row"><span class="segment-color" style="background:var(--accent)"></span><div class="segment-row-main"><strong>Worker endpoint</strong><small>/api/telegram/webhook</small></div><span class="pill green">Активен</span></div><div class="segment-row"><span class="segment-color" style="background:var(--yellow)"></span><div class="segment-row-main"><strong>Telegram Bot API</strong><small>${state.health?.checks?.telegram === 'configured' ? 'Секреты добавлены' : 'Ожидает настройки секретов'}</small></div><span class="pill ${state.health?.checks?.telegram === 'configured'?'green':'yellow'}">${state.health?.checks?.telegram === 'configured'?'Настроен':'Не настроен'}</span></div></div></section></div>`;
}

function closeModal() { $('#modal-root').innerHTML = ''; }

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = $('#admin-token').value.trim();
  if (token.length < 32) { setAuthMessage('Ключ должен содержать не менее 32 символов.'); return; }
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true; button.textContent = 'Проверяем…'; setAuthMessage('');
  try {
    const response = await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error === 'admin_token_not_configured' ? 'Сначала добавьте ADMIN_TOKEN в Cloudflare Worker Secrets.' : 'Неверный административный ключ.');
    state.token = token; try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* session storage can be disabled */ } $('#admin-token').value = ''; enterApp();
  } catch (error) { setAuthMessage(error.message); }
  finally { button.disabled = false; button.textContent = 'Открыть систему'; }
});

$('#app-shell').addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-page]');
  if (nav) { navigate(nav.dataset.page); return; }
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;
  try {
    if (action === 'add-lead') await openLeadModal();
    else if (action === 'edit-lead') await openLeadModal(id);
    else if (action === 'goto-segments') navigate('segments');
    else if (action === 'goto-activity') navigate('activity');
    else if (action === 'add-segment') await openSegmentModal();
    else if (action === 'edit-segment') await openSegmentModal(id);
    else if (action === 'delete-lead') await deleteLead(id);
    else if (action === 'delete-segment') await deleteSegment(id);
    else if (action === 'close-modal') closeModal();
    else if (action === 'backdrop-close' && event.target === actionEl) closeModal();
    else if (action === 'page-prev') { state.leadsPage = Math.max(1, state.leadsPage - 1); await loadLeads(); }
    else if (action === 'page-next') { state.leadsPage += 1; await loadLeads(); }
    else if (action === 'apply-bulk') await applyBulk();
    else if (action === 'clear-selection') { state.selected.clear(); await loadLeads(); }
    else if (action === 'retry') navigate(state.page);
    else if (action === 'open-segment-leads') { state.segmentId = id; state.leadsPage = 1; navigate('leads'); }
  } catch (error) { showToast(error.message || 'Не удалось выполнить действие.'); }
});


$('#modal-root').addEventListener('click', async (event) => {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;
  try {
    if (action === 'close-modal') closeModal();
    else if (action === 'backdrop-close' && event.target === actionEl) closeModal();
    else if (action === 'delete-lead') await deleteLead(id);
    else if (action === 'delete-segment') await deleteSegment(id);
  } catch (error) { showToast(error.message || 'Не удалось выполнить действие.'); }
});

$('#modal-root').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'lead-form') {
    const button = $('button[type="submit"]', event.target); button.disabled = true;
    try { await saveLeadForm(event.target); } catch (error) { showToast(error.message); }
    finally { button.disabled = false; }
  }
  if (event.target.id === 'segment-form') {
    const button = $('button[type="submit"]', event.target); button.disabled = true;
    try { await saveSegmentForm(event.target); } catch (error) { showToast(error.message); }
    finally { button.disabled = false; }
  }
});

$('#app-shell').addEventListener('change', async (event) => {
  const target = event.target;
  if (target.id === 'lead-status-filter') { state.status = target.value; state.leadsPage = 1; await loadLeads(); }
  if (target.id === 'lead-quality-filter') { state.quality = target.value; state.leadsPage = 1; await loadLeads(); }
  if (target.id === 'lead-segment-filter') { state.segmentId = target.value; state.leadsPage = 1; await loadLeads(); }
  if (target.id === 'page-size') { state.pageSize = Number(target.value); state.leadsPage = 1; await loadLeads(); }
  if (target.id === 'select-all') {
    const visibleIds = state.leads.map((lead) => lead.id);
    if (target.checked) visibleIds.forEach((id) => state.selected.add(id)); else visibleIds.forEach((id) => state.selected.delete(id));
    renderLeads({ items: state.leads, pagination: { page: state.leadsPage, pages: Math.max(1, Math.ceil(state.totalLeads/state.pageSize)), total: state.totalLeads } });
  }
  if (target.classList.contains('lead-select')) {
    if (target.checked) state.selected.add(target.dataset.id); else state.selected.delete(target.dataset.id);
    renderLeads({ items: state.leads, pagination: { page: state.leadsPage, pages: Math.max(1, Math.ceil(state.totalLeads/state.pageSize)), total: state.totalLeads } });
  }
});

let searchTimer = null;
$('#app-shell').addEventListener('input', (event) => {
  if (event.target.id === 'lead-search') {
    state.search = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.leadsPage = 1; loadLeads(); }, 250);
  }
});
$('#top-add-lead').addEventListener('click', () => openLeadModal());
$('#logout-button').addEventListener('click', () => logout());

$('#app-shell').addEventListener('submit', async (event) => {
  if (event.target.id !== 'webhook-form') return;
  event.preventDefault();
  const result = $('#webhook-result');
  const button = $('button[type="submit"]', event.target);
  result.textContent = '';
  if (state.demo) { result.textContent = 'В локальном DEMO-режиме Telegram не подключается.'; return; }
  button.disabled = true; button.textContent = 'Подключение…';
  try {
    const response = await fetch('/api/setup/telegram-webhook', { method: 'POST', headers: { 'X-Setup-Token': $('#setup-token').value.trim() } });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Не удалось зарегистрировать webhook.');
    result.style.color = 'var(--green)'; result.textContent = `Webhook подключён${data.bot_username ? ` для @${data.bot_username}` : ''}. Откройте бота и отправьте /start.`;
    $('#setup-token').value = ''; state.health = await fetch('/api/health').then((r) => r.json());
  } catch (error) { result.style.color = 'var(--red)'; result.textContent = error.message; }
  finally { button.disabled = false; button.textContent = 'Зарегистрировать webhook'; }
});

async function start() {
  if (state.demo) {
    enterApp();
  } else {
    await authenticateLive();
  }
}
start();
