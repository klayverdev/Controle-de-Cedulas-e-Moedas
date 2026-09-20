import { api, ApiError } from './api.js';

/* ------------------------------------------------------------------------ *
 * Configuração
 * ------------------------------------------------------------------------ */

const DENOMINATIONS = [
  { value: 200, type: 'nota' },
  { value: 100, type: 'nota' },
  { value: 50, type: 'nota' },
  { value: 20, type: 'nota' },
  { value: 10, type: 'nota' },
  { value: 5, type: 'nota' },
  { value: 2, type: 'nota' },
  { value: 1, type: 'moeda' },
  { value: 0.5, type: 'moeda' },
  { value: 0.25, type: 'moeda' },
  { value: 0.1, type: 'moeda' },
  { value: 0.05, type: 'moeda' },
];

const LOGIN_PAGE = '/login.html';
const QUICK_ADD_STEPS = [1, 5, 10, 20];
const IMPORT_LINE_PATTERN = /(\d+)\s*x\s*R\$\s*([\d.]+)/i;

const GEAR_ICON = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
`;

/* ------------------------------------------------------------------------ *
 * Estado
 * ------------------------------------------------------------------------ */

const state = {
  history: [],
  deletedHistory: [],
};

let pendingDeleteId = null;
let pendingCopyValues = null;
let isSaving = false;

/* ------------------------------------------------------------------------ *
 * DOM cache
 * ------------------------------------------------------------------------ */

const dom = {
  userEmail: document.getElementById('user-email'),
  inputsGrid: document.getElementById('main-inputs'),
  log: document.getElementById('log'),
  totalNotas: document.getElementById('total-notas'),
  totalMoedas: document.getElementById('total-moedas'),
  totalGeral: document.getElementById('total-geral'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
  importField: document.getElementById('import-field'),
  importType: document.getElementById('import-type'),
  importText: document.getElementById('import-text'),
  deleteArea: document.getElementById('delete-area'),
  deletedField: document.getElementById('deleted-field'),
  deletedList: document.getElementById('deleted-list'),
  copyArea: document.getElementById('copy-area'),
  copyButton: document.querySelector('#copy-area [data-action="copy-balance"]'),
};

/* ------------------------------------------------------------------------ *
 * Utilidades de formatação
 * ------------------------------------------------------------------------ */

function formatCurrency(value) {
  return `R$ ${value.toFixed(2)}`;
}

function formatDenominationValue(value) {
  return value >= 1 ? String(value) : value.toFixed(2);
}

function denominationType(value) {
  return DENOMINATIONS.find((d) => d.value === value)?.type;
}

function isNote(value) {
  return denominationType(value) === 'nota';
}

function isKnownDenomination(value) {
  return DENOMINATIONS.some((d) => d.value === value);
}

function escapeHtml(text) {
  const element = document.createElement('div');
  element.textContent = text;
  return element.innerHTML;
}

function entryLabel({ direction, source }) {
  const label = direction > 0 ? 'Entrada' : 'Retirada';
  return source === 'import' ? `Importação ${label}` : label;
}

function sumValues(values) {
  return Object.entries(values).reduce((sum, [value, quantity]) => sum + Number(value) * quantity, 0);
}

function computeInventory() {
  const inventory = new Map();

  state.history.forEach(({ direction, values }) => {
    Object.entries(values).forEach(([rawValue, quantity]) => {
      const value = Number(rawValue);
      inventory.set(value, (inventory.get(value) ?? 0) + quantity * direction);
    });
  });

  return inventory;
}

/* ------------------------------------------------------------------------ *
 * Renderização — grade de cédulas e moedas
 * ------------------------------------------------------------------------ */

function buildDenominationsGrid() {
  const fragment = document.createDocumentFragment();

  DENOMINATIONS.forEach(({ value }) => {
    const row = document.createElement('div');
    row.className = 'denomination';

    const head = document.createElement('div');
    head.className = 'denomination__head';

    const label = document.createElement('label');
    label.className = 'denomination__label';
    label.textContent = `R$ ${formatDenominationValue(value)}`;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.className = 'denomination__input';
    input.value = '0';
    input.dataset.value = String(value);
    input.setAttribute('aria-label', `Quantidade de R$ ${formatDenominationValue(value)}`);

    head.append(label, input);

    const quickAdd = document.createElement('div');
    quickAdd.className = 'quick-add';

    QUICK_ADD_STEPS.forEach((step) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-add__btn';
      button.textContent = `+${step}`;
      button.dataset.action = 'quick-add';
      button.dataset.step = String(step);
      quickAdd.appendChild(button);
    });

    row.append(head, quickAdd);
    fragment.appendChild(row);
  });

  dom.inputsGrid.appendChild(fragment);
}

/* ------------------------------------------------------------------------ *
 * Renderização — histórico e totais
 * ------------------------------------------------------------------------ */

function renderHistory() {
  dom.log.innerHTML = '';

  if (state.history.length === 0) {
    dom.log.innerHTML = '<p class="history__empty">Nenhuma operação registrada ainda.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  [...state.history].reverse().forEach((entry) => {
    const item = document.createElement('div');
    item.className = `history-item ${entry.direction > 0 ? 'history-item--in' : 'history-item--out'}`;
    item.innerHTML = `
      <div>
        <strong class="history-item__label">${entryLabel(entry)}</strong>
        <span class="history-item__amount">${formatCurrency(sumValues(entry.values))}</span>
      </div>
      <button type="button" class="btn btn-icon" data-action="show-history-details" data-id="${entry.id}" aria-label="Ver detalhes da operação">
        ${GEAR_ICON}
      </button>
    `;
    fragment.appendChild(item);
  });

  dom.log.appendChild(fragment);
}

function renderTotals() {
  let notesTotal = 0;
  let coinsTotal = 0;

  computeInventory().forEach((quantity, value) => {
    if (isNote(value)) notesTotal += quantity * value;
    else coinsTotal += quantity * value;
  });

  dom.totalNotas.textContent = formatCurrency(notesTotal);
  dom.totalMoedas.textContent = formatCurrency(coinsTotal);
  dom.totalGeral.textContent = (notesTotal + coinsTotal).toFixed(2);
}

function describeValues(values) {
  const notes = [];
  const coins = [];

  Object.entries(values).forEach(([rawValue, quantity]) => {
    if (quantity === 0) return;
    const value = Number(rawValue);
    const line = `<strong>${quantity}x</strong> R$ ${formatDenominationValue(value)}`;
    (isNote(value) ? notes : coins).push(line);
  });

  return `
    <p class="modal__group-title">Notas</p>
    <p class="modal__group-body">${notes.join('<br>') || 'Nenhuma'}</p>
    <p class="modal__group-title">Moedas</p>
    <p class="modal__group-body">${coins.join('<br>') || 'Nenhuma'}</p>
  `;
}

function buildPlainTextSummary(values) {
  const notes = [];
  const coins = [];

  Object.entries(values).forEach(([rawValue, quantity]) => {
    if (quantity === 0) return;
    const value = Number(rawValue);
    const line = `${quantity}x R$ ${formatDenominationValue(value)}`;
    (isNote(value) ? notes : coins).push(line);
  });

  const blocks = [];
  if (notes.length) blocks.push(`Notas\n${notes.join('\n')}`);
  if (coins.length) blocks.push(`Moedas\n${coins.join('\n')}`);

  return blocks.join('\n');
}

/* ------------------------------------------------------------------------ *
 * Renderização — operações apagadas
 * ------------------------------------------------------------------------ */

function renderDeletedList() {
  dom.deletedList.innerHTML = '';

  if (state.deletedHistory.length === 0) {
    dom.deletedList.innerHTML = '<p class="deleted-list__empty">Nenhuma operação apagada.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  [...state.deletedHistory].reverse().forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'deleted-item';
    item.innerHTML = `
      <div>
        <strong class="deleted-item__label">${entryLabel(entry)}</strong>
        <span class="deleted-item__amount">${formatCurrency(sumValues(entry.values))}</span>
      </div>
      <button type="button" class="btn btn-outline" data-action="restore-history-entry" data-id="${entry.id}">
        Recuperar
      </button>
    `;
    fragment.appendChild(item);
  });

  dom.deletedList.appendChild(fragment);
}

/* ------------------------------------------------------------------------ *
 * Operações de caixa
 * ------------------------------------------------------------------------ */

async function saveOperation(payload) {
  if (isSaving) return false;
  isSaving = true;

  try {
    state.history.push(await api.createOperation(payload));
    renderHistory();
    renderTotals();
    return true;
  } finally {
    isSaving = false;
  }
}

function readDenominationInputs() {
  const values = {};

  dom.inputsGrid.querySelectorAll('.denomination__input').forEach((input) => {
    const quantity = parseInt(input.value, 10) || 0;
    if (quantity > 0) values[Number(input.dataset.value)] = quantity;
  });

  return values;
}

function resetDenominationInputs() {
  dom.inputsGrid.querySelectorAll('.denomination__input').forEach((input) => {
    input.value = '0';
  });
}

async function processEntry(direction) {
  const values = readDenominationInputs();
  if (Object.keys(values).length === 0) return;

  if (await saveOperation({ direction, source: 'manual', values })) resetDenominationInputs();
}

async function deleteHistoryEntry() {
  if (pendingDeleteId === null) return;

  const id = pendingDeleteId;
  await api.deleteOperation(id);

  const index = state.history.findIndex((entry) => entry.id === id);
  if (index !== -1) state.deletedHistory.push(...state.history.splice(index, 1));

  renderHistory();
  renderTotals();
  closeModal();
}

async function restoreHistoryEntry(id) {
  const entry = await api.restoreOperation(id);

  state.deletedHistory = state.deletedHistory.filter((item) => item.id !== id);
  state.history = [...state.history, entry].sort((a, b) => a.id - b.id);

  renderHistory();
  renderTotals();
  renderDeletedList();

  if (state.deletedHistory.length === 0) closeModal();
}

function parseImportText(text) {
  const values = {};

  text.split('\n').forEach((line) => {
    const match = line.match(IMPORT_LINE_PATTERN);
    if (!match) return;

    const quantity = parseInt(match[1], 10);
    const value = parseFloat(match[2]);
    if (quantity <= 0 || !isKnownDenomination(value)) return;

    values[value] = (values[value] ?? 0) + quantity;
  });

  return values;
}

async function processImport() {
  const direction = Number(dom.importType.value);
  const values = parseImportText(dom.importText.value);
  if (Object.keys(values).length === 0) return;

  if (await saveOperation({ direction, source: 'import', values })) {
    dom.importText.value = '';
    closeModal();
  }
}

async function logout() {
  await api.logout();
  window.location.replace(LOGIN_PAGE);
}

/* ------------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------------ */

function openDetailModal(title, bodyHtml, deleteId = null, copyValues = null) {
  dom.modalTitle.textContent = title;
  dom.modalBody.hidden = false;
  dom.modalBody.innerHTML = bodyHtml;
  dom.importField.hidden = true;
  dom.deletedField.hidden = true;

  pendingDeleteId = deleteId;
  dom.deleteArea.hidden = deleteId === null;

  pendingCopyValues = copyValues;
  dom.copyArea.hidden = copyValues === null;
  if (copyValues !== null) resetCopyButton();

  dom.modal.classList.add('is-open');
}

function openImportModal() {
  dom.modalTitle.textContent = 'Importar contagem';
  dom.modalBody.hidden = true;
  dom.deleteArea.hidden = true;
  dom.importField.hidden = false;
  dom.deletedField.hidden = true;
  dom.copyArea.hidden = true;
  pendingCopyValues = null;
  dom.modal.classList.add('is-open');
}

function closeModal() {
  dom.modal.classList.remove('is-open');
  pendingDeleteId = null;
  pendingCopyValues = null;
}

function showHistoryDetails(id) {
  const entry = state.history.find((item) => item.id === id);
  if (!entry) return;
  openDetailModal(`${entryLabel(entry)} — detalhes`, describeValues(entry.values), entry.id, entry.values);
}

function showCurrentBalance() {
  const values = {};
  computeInventory().forEach((quantity, value) => {
    if (quantity !== 0) values[value] = quantity;
  });
  openDetailModal('Saldo atual em caixa', describeValues(values), null, values);
}

function resetCopyButton() {
  if (!dom.copyButton) return;
  dom.copyButton.textContent = 'Copiar contagem';
  dom.copyButton.classList.remove('is-copied');
}

function copyBalanceToClipboard() {
  if (!pendingCopyValues) return;
  const text = buildPlainTextSummary(pendingCopyValues);
  if (!text) return;

  const onCopied = () => {
    dom.copyButton.textContent = 'Copiado!';
    dom.copyButton.classList.add('is-copied');
    setTimeout(resetCopyButton, 1500);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onCopied).catch(() => fallbackCopy(text, onCopied));
  } else {
    fallbackCopy(text, onCopied);
  }
}

function fallbackCopy(text, onCopied) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    onCopied();
  } catch (error) {
    console.error('Não foi possível copiar automaticamente.', error);
  } finally {
    document.body.removeChild(textarea);
  }
}

function showDeletedHistory() {
  dom.modalTitle.textContent = 'Operações apagadas';
  dom.modalBody.hidden = true;
  dom.importField.hidden = true;
  dom.deleteArea.hidden = true;
  dom.deletedField.hidden = false;
  dom.copyArea.hidden = true;

  pendingDeleteId = null;
  pendingCopyValues = null;

  renderDeletedList();
  dom.modal.classList.add('is-open');
}

/* ------------------------------------------------------------------------ *
 * Eventos
 * ------------------------------------------------------------------------ */

async function handleAction(target) {
  switch (target.dataset.action) {
    case 'quick-add': {
      const input = target.closest('.denomination').querySelector('.denomination__input');
      input.value = (parseInt(input.value, 10) || 0) + Number(target.dataset.step);
      break;
    }
    case 'record':
      await processEntry(Number(target.dataset.direction));
      break;
    case 'open-import':
      openImportModal();
      break;
    case 'process-import':
      await processImport();
      break;
    case 'show-balance':
      showCurrentBalance();
      break;
    case 'show-history-details':
      showHistoryDetails(Number(target.dataset.id));
      break;
    case 'delete-history-entry':
      await deleteHistoryEntry();
      break;
    case 'show-deleted':
      showDeletedHistory();
      break;
    case 'restore-history-entry':
      await restoreHistoryEntry(Number(target.dataset.id));
      break;
    case 'copy-balance':
      copyBalanceToClipboard();
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'logout':
      await logout();
      break;
  }
}

function handleError(error) {
  if (error instanceof ApiError && error.status === 401) {
    window.location.replace(LOGIN_PAGE);
    return;
  }

  console.error(error);
  openDetailModal(
    'Não foi possível concluir',
    `<p class="modal__group-body">${escapeHtml(error.message)}</p>`,
  );
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  try {
    await handleAction(target);
  } catch (error) {
    handleError(error);
  }
});

dom.modal.addEventListener('click', (event) => {
  if (event.target === dom.modal) closeModal();
});

/* ------------------------------------------------------------------------ *
 * Inicialização
 * ------------------------------------------------------------------------ */

async function init() {
  buildDenominationsGrid();

  try {
    const [{ user }, operations] = await Promise.all([api.me(), api.listOperations()]);

    dom.userEmail.textContent = user.email;
    state.history = operations.filter((operation) => !operation.deletedAt);
    state.deletedHistory = operations.filter((operation) => operation.deletedAt);
  } catch (error) {
    handleError(error);
  }

  renderHistory();
  renderTotals();
}

init();
