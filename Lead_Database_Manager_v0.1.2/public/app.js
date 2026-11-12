const $ = (id) => document.getElementById(id);
const isLocalPreview = window.location.protocol === 'file:';

function setPill(element, label, kind) {
  if (!element) return;
  element.textContent = label;
  element.className = `status-pill ${kind || ''}`.trim();
}

function showToast(message) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3500);
}

function showLocalPreview() {
  $('checkModeLabel').textContent = 'OFFLINE PREVIEW';
  setPill($('dbPill'), 'Нужно подключить', 'preview');
  $('dbText').textContent = 'Это локальный просмотр интерфейса. Реальная проверка D1 появится после публикации Worker в Cloudflare.';
  $('leadCount').textContent = '—';
  setPill($('tgPill'), 'Не подключён', 'preview');
  $('tgText').textContent = 'Telegram API проверяется после добавления секретов в настройках Cloudflare Worker.';
  setPill($('workerPill'), 'Локальный файл', 'preview');
  $('workerText').textContent = 'Worker не запускается из HTML-файла. Откройте опубликованный адрес после развёртывания в Cloudflare.';
  $('setupToken').disabled = true;
  $('registerButton').disabled = true;
  $('registerButton').textContent = 'После публикации';
  $('setupToken').placeholder = 'Будет доступно после публикации Worker';
  $('setupResult').textContent = 'Локальный предпросмотр не отправляет запросы и не подключается к Telegram. Это ожидаемое поведение.';
}

async function refreshHealth() {
  if (isLocalPreview) {
    showLocalPreview();
    showToast('Открыт локальный предпросмотр. Для проверки API нужна публикация в Cloudflare.');
    return;
  }

  $('checkModeLabel').textContent = 'LIVE CHECK';
  $('dbText').textContent = 'Проверяем соединение с базой данных…';
  $('tgText').textContent = 'Проверяем наличие конфигурации…';
  $('workerText').textContent = 'Проверяем ответ Worker…';
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const data = await response.json();
    const checks = data.checks || {};
    const db = checks.database;
    if (db === 'connected') {
      setPill($('dbPill'), 'Подключена', 'ok');
      $('dbText').textContent = 'Worker успешно выполнил запрос к таблице leads.';
      $('leadCount').textContent = Number(data.leads_count || 0).toLocaleString('ru-RU');
    } else {
      setPill($('dbPill'), db === 'not_configured' ? 'Нет binding' : 'Ошибка схемы', 'error');
      $('dbText').textContent = db === 'not_configured' ? 'Добавьте D1 binding с именем DB.' : 'Проверьте, применена ли миграция 0001.';
      $('leadCount').textContent = '—';
    }
    if (checks.telegram === 'configured') {
      setPill($('tgPill'), 'Настроен', 'ok');
      $('tgText').textContent = 'Секреты Telegram присутствуют в конфигурации Worker.';
    } else {
      setPill($('tgPill'), 'Не настроен', 'error');
      $('tgText').textContent = 'Добавьте токен бота и webhook secret в Worker Secrets.';
    }
    if (checks.worker === 'ok') {
      setPill($('workerPill'), 'Активен', 'ok');
      $('workerText').textContent = 'Серверная точка входа отвечает на запросы.';
    } else {
      setPill($('workerPill'), 'Нет ответа', 'error');
      $('workerText').textContent = 'Проверьте публикацию и доступность Worker.';
    }
    if (!response.ok) showToast('Проверка завершилась: есть неподготовленные компоненты.');
  } catch {
    setPill($('dbPill'), 'Нет ответа', 'error');
    setPill($('tgPill'), 'Не проверен', 'error');
    setPill($('workerPill'), 'Нет ответа', 'error');
    $('dbText').textContent = 'API недоступен. Проверьте публикацию Worker.';
    $('tgText').textContent = 'Статус интеграции получить не удалось.';
    $('workerText').textContent = 'Сервер не ответил на проверочный запрос.';
    $('leadCount').textContent = '—';
  }
}

async function registerWebhook() {
  if (isLocalPreview) {
    $('setupResult').textContent = 'Сначала опубликуйте Worker в Cloudflare. Установка программ на компьютер не требуется.';
    return;
  }
  const tokenInput = $('setupToken');
  const token = tokenInput.value.trim();
  const button = $('registerButton');
  const result = $('setupResult');
  result.textContent = '';
  result.classList.remove('error');
  if (!token) {
    result.textContent = 'Введите SETUP_TOKEN.';
    result.classList.add('error');
    return;
  }
  button.disabled = true;
  button.textContent = 'Подключение…';
  try {
    const response = await fetch('/api/setup/telegram-webhook', {
      method: 'POST',
      headers: { 'X-Setup-Token': token },
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Не удалось зарегистрировать webhook.');
    result.textContent = data.bot_username
      ? `Webhook зарегистрирован для @${data.bot_username}. Теперь откройте бота и отправьте /start.`
      : 'Webhook зарегистрирован. Теперь откройте бота и отправьте /start.';
    showToast('Telegram webhook успешно зарегистрирован.');
  } catch (error) {
    result.textContent = error.message || 'Ошибка регистрации webhook.';
    result.classList.add('error');
  } finally {
    tokenInput.value = '';
    button.disabled = false;
    button.textContent = 'Зарегистрировать';
    await refreshHealth();
  }
}

$('refreshButton').addEventListener('click', refreshHealth);
$('registerButton').addEventListener('click', registerWebhook);
refreshHealth();
