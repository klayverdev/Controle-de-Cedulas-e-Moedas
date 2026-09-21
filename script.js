'use strict';

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
  inventory: new Map(DENOMINATIONS.map((d) => [d.value, 0])),
  history: [],
  deletedHistory: [],
};

let pendingDeleteId = null;
let pendingCopyValues = null;

/* ------------------------------------------------------------------------ *
 * DOM cache
 * ------------------------------------------------------------------------ */

const dom = {
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
        <strong class="history-item__label">${entry.label}</strong>
        <span class="history-item__amount">${formatCurrency(entry.notesTotal + entry.coinsTotal)}</span>
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

  state.inventory.forEach((quantity, value) => {
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
        <strong class="deleted-item__label">${entry.label}</strong>
        <span class="deleted-item__amount">${formatCurrency(entry.notesTotal + entry.coinsTotal)}</span>
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

function processEntry(direction) {
  const entry = { values: {}, notesTotal: 0, coinsTotal: 0, direction };

  dom.inputsGrid.querySelectorAll('.denomination__input').forEach((input) => {
    const quantity = parseInt(input.value, 10) || 0;
    if (quantity <= 0) return;

    const value = Number(input.dataset.value);
    entry.values[value] = quantity;
    state.inventory.set(value, state.inventory.get(value) + quantity * direction);

    if (isNote(value)) entry.notesTotal += quantity * value;
    else entry.coinsTotal += quantity * value;

    input.value = '0';
  });

  if (entry.notesTotal === 0 && entry.coinsTotal === 0) return;

  addHistoryEntry(direction > 0 ? 'Entrada' : 'Retirada', entry);
  renderTotals();
}

function addHistoryEntry(label, entry) {
  entry.id = Date.now();
  entry.label = label;
  state.history.push(entry);
  renderHistory();
}

function deleteHistoryEntry() {
  if (pendingDeleteId === null) return;

  const index = state.history.findIndex((entry) => entry.id === pendingDeleteId);
  if (index === -1) return;

  const [entry] = state.history.splice(index, 1);
  Object.entries(entry.values).forEach(([rawValue, quantity]) => {
    const value = Number(rawValue);
    state.inventory.set(value, state.inventory.get(value) - quantity * entry.direction);
  });

  state.deletedHistory.push(entry);

  renderHistory();
  renderTotals();
  closeModal();
}

function restoreHistoryEntry(id) {
  const index = state.deletedHistory.findIndex((entry) => entry.id === id);
  if (index === -1) return;

  const [entry] = state.deletedHistory.splice(index, 1);
  Object.entries(entry.values).forEach(([rawValue, quantity]) => {
    const value = Number(rawValue);
    state.inventory.set(value, (state.inventory.get(value) || 0) + quantity * entry.direction);
  });
  state.history.push(entry);

  renderHistory();
  renderTotals();
  renderDeletedList();

  if (state.deletedHistory.length === 0) closeModal();
}

function processImport() {
  const direction = Number(dom.importType.value);
  const lines = dom.importText.value.split('\n');
  const entry = { values: {}, notesTotal: 0, coinsTotal: 0, direction };

  lines.forEach((line) => {
    const match = line.match(IMPORT_LINE_PATTERN);
    if (!match) return;

    const quantity = parseInt(match[1], 10);
    const value = parseFloat(match[2]);

    entry.values[value] = quantity;
    state.inventory.set(value, (state.inventory.get(value) || 0) + quantity * direction);

    if (isNote(value)) entry.notesTotal += quantity * value;
    else entry.coinsTotal += quantity * value;
  });

  addHistoryEntry(direction > 0 ? 'Importação Entrada' : 'Importação Retirada', entry);
  renderTotals();
  closeModal();
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
  openDetailModal(`${entry.label} — detalhes`, describeValues(entry.values), entry.id, entry.values);
}

function showCurrentBalance() {
  const values = {};
  state.inventory.forEach((quantity, value) => {
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

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  switch (target.dataset.action) {
    case 'quick-add': {
      const input = target.closest('.denomination').querySelector('.denomination__input');
      input.value = (parseInt(input.value, 10) || 0) + Number(target.dataset.step);
      break;
    }
    case 'record':
      processEntry(Number(target.dataset.direction));
      break;
    case 'open-import':
      openImportModal();
      break;
    case 'process-import':
      processImport();
      break;
    case 'show-balance':
      showCurrentBalance();
      break;
    case 'show-history-details':
      showHistoryDetails(Number(target.dataset.id));
      break;
    case 'delete-history-entry':
      deleteHistoryEntry();
      break;
    case 'show-deleted':
      showDeletedHistory();
      break;
    case 'restore-history-entry':
      restoreHistoryEntry(Number(target.dataset.id));
      break;
    case 'copy-balance':
      copyBalanceToClipboard();
      break;
    case 'close-modal':
      closeModal();
      break;
  }
});

dom.modal.addEventListener('click', (event) => {
  if (event.target === dom.modal) closeModal();
});

/* ------------------------------------------------------------------------ *
 * Inicialização
 * ------------------------------------------------------------------------ */

function init() {
  buildDenominationsGrid();
  renderHistory();
  renderTotals();
}

init();
