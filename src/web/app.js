const authGate = document.getElementById('authGate');
const mainApp = document.getElementById('mainApp');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const authError = document.getElementById('authError');
const inboxSelect = document.getElementById('inboxSelect');
const copyBtn = document.getElementById('copyBtn');
const refreshBtn = document.getElementById('refreshBtn');
const newBtn = document.getElementById('newBtn');
const deleteBtn = document.getElementById('deleteBtn');
const newBox = document.getElementById('newBox');
const createCustomBtn = document.getElementById('createCustomBtn');
const createRandomBtn = document.getElementById('createRandomBtn');
const localPartInput = document.getElementById('localPartInput');
const domainSelect = document.getElementById('domainSelect');
const currentInbox = document.getElementById('currentInbox');
const messageCount = document.getElementById('messageCount');
const messageList = document.getElementById('messageList');
const appTitle = document.getElementById('appTitle');
const appSubtitle = document.getElementById('appSubtitle');
const apiKeyNameInput = document.getElementById('apiKeyNameInput');
const createApiKeyBtn = document.getElementById('createApiKeyBtn');
const apiKeyList = document.getElementById('apiKeyList');
const newApiKeyOutput = document.getElementById('newApiKeyOutput');

let appConfig = {
  appName: 'Pakuan Mail',
  mailDomain: 'pakuan.web.id',
  webHost: 'tempmail.pakuan.web.id'
};

const SESSION_KEY = 'tempik_session_id';
let sessionId = localStorage.getItem(SESSION_KEY) || '';

function parseError(text) {
  try {
    return JSON.parse(text).error || text;
  } catch {
    return text;
  }
}

async function fetchJson(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (sessionId) {
    headers['x-session-id'] = sessionId;
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  if (res.status === 401 && url !== '/api/auth') {
    showLogin('Session locked. Enter password again.');
  }

  if (!res.ok) throw new Error(parseError(await res.text()));
  return res.json();
}

function showLogin(message = '') {
  localStorage.removeItem(SESSION_KEY);
  sessionId = '';
  mainApp.classList.add('hidden');
  authGate.classList.remove('hidden');
  authError.textContent = message;
  passwordInput.focus();
}

function showApp() {
  authGate.classList.add('hidden');
  mainApp.classList.remove('hidden');
  authError.textContent = '';
}

function emptyState(icon, title, sub) {
  const root = document.createElement('div');
  root.className = 'empty-state';

  const iconEl = document.createElement('div');
  iconEl.className = 'icon';
  iconEl.textContent = icon;

  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = title;

  const subEl = document.createElement('div');
  subEl.className = 'sub';
  subEl.textContent = sub;

  root.append(iconEl, titleEl, subEl);
  return root;
}

function showError(message) {
  messageList.replaceChildren(emptyState('⚠️', 'Connection error', message));
}

async function login() {
  const password = passwordInput.value;
  authError.textContent = '';
  loginBtn.disabled = true;

  try {
    await fetchJson('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    passwordInput.value = '';
    await startApp();
  } catch (err) {
    authError.textContent = err.message || 'Unauthorized';
    passwordInput.select();
  } finally {
    loginBtn.disabled = false;
  }
}

async function loadConfig() {
  appConfig = await fetchJson('/api/config', { headers: {} });
  document.title = appConfig.appName;
  appTitle.textContent = appConfig.appName;
  appSubtitle.textContent = `Private disposable inbox for ${appConfig.mailDomain}`;
  localPartInput.placeholder = `username atau kosongkan untuk random @${appConfig.mailDomain}`;

  // Populate domain selector
  const domains = appConfig.mailDomains || [appConfig.mailDomain];
  domainSelect.replaceChildren();
  domains.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `@${d}`;
    domainSelect.appendChild(opt);
  });
  if (domains.length <= 1) domainSelect.style.display = 'none';
}

async function ensureSession() {
  try {
    const payload = await fetchJson('/api/session');
    sessionId = payload.sessionId;
    localStorage.setItem(SESSION_KEY, sessionId);
  } catch (err) {
    if (!sessionId) throw err;
    localStorage.removeItem(SESSION_KEY);
    sessionId = '';
    const payload = await fetchJson('/api/session');
    sessionId = payload.sessionId;
    localStorage.setItem(SESSION_KEY, sessionId);
  }
}

async function loadInboxes(selectedAddress) {
  const inboxes = await fetchJson('/api/inboxes');
  inboxSelect.replaceChildren();

  if (!inboxes.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Belum ada inbox';
    inboxSelect.appendChild(opt);
    currentInbox.textContent = 'No inbox selected';
    messageList.replaceChildren(emptyState('📬', 'No Pakuan inboxes yet', 'Click New to create a private disposable address.'));
    messageCount.textContent = '0 messages';
    return;
  }

  inboxes.forEach((inbox) => {
    const opt = document.createElement('option');
    opt.value = inbox.address;
    opt.textContent = inbox.address;
    inboxSelect.appendChild(opt);
  });

  inboxSelect.value = selectedAddress && inboxes.some((x) => x.address === selectedAddress)
    ? selectedAddress
    : inboxes[0].address;

  await loadMessages();
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function cleanMessageBody(value) {
  return (value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderMessage(msg) {
  const item = document.createElement('article');
  item.className = 'message-item';

  const header = document.createElement('div');
  header.className = 'message-header';

  const sender = document.createElement('div');
  sender.className = 'message-sender';

  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = 'From';

  const from = document.createElement('span');
  from.className = 'message-from';
  from.textContent = msg.from_address || '(unknown sender)';
  from.title = msg.from_address || '';

  const date = document.createElement('time');
  date.className = 'message-date';
  date.dateTime = msg.received_at || '';
  date.textContent = formatDate(msg.received_at);

  sender.append(label, from);
  header.append(sender, date);

  const subject = document.createElement('h3');
  subject.className = 'message-subject';
  subject.textContent = msg.subject || '(no subject)';

  const body = document.createElement('p');
  body.className = 'message-body';
  body.textContent = cleanMessageBody(msg.body);

  item.append(header, subject, body);
  return item;
}

async function loadMessages() {
  const address = inboxSelect.value;
  if (!address) return;
  currentInbox.textContent = address;
  const payload = await fetchJson(`/api/inboxes/${encodeURIComponent(address)}/messages?limit=100&offset=0`);
  const messages = Array.isArray(payload) ? payload : payload.messages;
  messageCount.textContent = `${messages.length} messages`;

  if (!messages.length) {
    messageList.replaceChildren(emptyState('✉️', 'Inbox empty', 'Emails sent to this Pakuan Mail address will appear here.'));
    return;
  }

  messageList.replaceChildren(...messages.map(renderMessage));
}

function renderApiKey(key) {
  const row = document.createElement('div');
  row.className = 'api-key-row';

  const meta = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = key.name;
  const details = document.createElement('span');
  details.textContent = `${key.key_prefix}… • created ${new Date(key.created_at).toLocaleString()}${key.last_used_at ? ` • used ${new Date(key.last_used_at).toLocaleString()}` : ''}`;
  meta.append(name, details);

  const revoke = document.createElement('button');
  revoke.className = 'danger small';
  revoke.textContent = 'Revoke';
  revoke.addEventListener('click', async () => {
    if (!confirm(`Revoke API key ${key.name}?`)) return;
    await fetchJson(`/api/api-keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' });
    await loadApiKeys();
    showToast('API key revoked');
  });

  row.append(meta, revoke);
  return row;
}

async function loadApiKeys() {
  const keys = await fetchJson('/api/api-keys');
  apiKeyList.replaceChildren();
  if (!keys.length) {
    apiKeyList.replaceChildren(emptyState('🔑', 'No API keys yet', 'Create one for Claude or other agents.'));
    return;
  }
  apiKeyList.replaceChildren(...keys.map(renderApiKey));
}

function showCreatedApiKey(key) {
  const title = document.createElement('strong');
  title.textContent = 'Copy this key now. It will not be shown again.';
  const code = document.createElement('code');
  code.textContent = key.key;
  const copy = document.createElement('button');
  copy.textContent = '📋 Copy key';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(key.key);
    showToast('API key copied');
  });

  newApiKeyOutput.classList.remove('hidden');
  newApiKeyOutput.replaceChildren(title, code, copy);
}

async function createApiKey() {
  const name = apiKeyNameInput.value.trim();
  if (!name) return showToast('Enter a key name');

  createApiKeyBtn.disabled = true;
  try {
    const key = await fetchJson('/api/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    apiKeyNameInput.value = '';
    showCreatedApiKey(key);
    await loadApiKeys();
  } finally {
    createApiKeyBtn.disabled = false;
  }
}

async function startApp() {
  await loadConfig();
  await ensureSession();
  showApp();
  await loadInboxes();
  await loadApiKeys();
}

function showToast(text) {
  const tc = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  tc.appendChild(el);
  setTimeout(() => { el.classList.add('fadeout'); setTimeout(() => el.remove(), 200); }, 1800);
}

loginBtn.addEventListener('click', login);
passwordInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') login();
});

copyBtn.addEventListener('click', async () => {
  if (!inboxSelect.value) return;
  await navigator.clipboard.writeText(inboxSelect.value);
  showToast('📋 Copied to clipboard');
});

refreshBtn.addEventListener('click', () => loadMessages().catch((err) => showError(err.message)));
newBtn.addEventListener('click', () => newBox.classList.toggle('hidden'));
inboxSelect.addEventListener('change', () => loadMessages().catch((err) => showError(err.message)));

deleteBtn.addEventListener('click', async () => {
  if (!inboxSelect.value) return;
  if (!confirm(`Delete inbox ${inboxSelect.value}?`)) return;
  const target = inboxSelect.value;
  await fetchJson(`/api/inboxes/${encodeURIComponent(target)}`, { method: 'DELETE' });
  await loadInboxes();
});

createCustomBtn.addEventListener('click', async () => {
  const localPart = localPartInput.value.trim();
  const domain = domainSelect.value;
  const inbox = await fetchJson('/api/inboxes', {
    method: 'POST',
    body: JSON.stringify({ localPart, domain })
  });
  localPartInput.value = '';
  await loadInboxes(inbox.address);
});

createRandomBtn.addEventListener('click', async () => {
  const domain = domainSelect.value;
  const inbox = await fetchJson('/api/inboxes', {
    method: 'POST',
    body: JSON.stringify({ domain })
  });
  localPartInput.value = '';
  await loadInboxes(inbox.address);
});

createApiKeyBtn.addEventListener('click', () => createApiKey().catch((err) => showToast(err.message)));
apiKeyNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') createApiKey().catch((err) => showToast(err.message));
});

startApp().catch((err) => {
  if (err.message === 'Unauthorized' || err.message === 'Auth not configured') {
    showLogin(err.message === 'Auth not configured' ? 'Server auth is not configured.' : '');
    return;
  }
  console.error(err);
  showLogin(err.message);
});
