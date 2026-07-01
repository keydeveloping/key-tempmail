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

let appConfig = {
  appName: 'Pakuan Mail',
  mailDomain: 'pakuan.web.id',
  webHost: 'tempmail.pakuan.web.id'
};

const SESSION_KEY = 'tempik_session_id';
let sessionId = localStorage.getItem(SESSION_KEY) || '';

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
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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

function renderMessage(msg) {
  const item = document.createElement('div');
  item.className = 'message-item';

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = `From: ${msg.from_address} • ${new Date(msg.received_at).toLocaleString()}`;

  const subject = document.createElement('strong');
  subject.textContent = msg.subject || '(no subject)';

  const body = document.createElement('p');
  body.textContent = msg.body || '';

  item.append(meta, subject, body);
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

function showToast(text) {
  const tc = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  tc.appendChild(el);
  setTimeout(() => { el.classList.add('fadeout'); setTimeout(() => el.remove(), 200); }, 1800);
}

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

Promise.all([loadConfig(), ensureSession()]).then(() => loadInboxes()).catch((err) => {
  console.error(err);
  showError(err.message);
});
