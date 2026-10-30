'use strict';

/* ------------------------------------------------------------------------ *
 * Leitura de cédulas e moedas por foto
 * Carregado depois do script.js. A foto só PREENCHE os campos de quantidade;
 * quem salva a entrada ou a retirada continua sendo o usuário.
 * ------------------------------------------------------------------------ */

// Endereço da Worker publicada, sem barra no final.
// Se ficar vazio, o botão "Enviar foto" avisa que falta configurar.
const PHOTO_WORKER_URL = 'https://leitura-cedulas.klayverdev.workers.dev';

const PHOTO_MAX_SIDE = 1024;
const PHOTO_JPEG_QUALITY = 0.85;

const PHOTO_ERROR_MESSAGES = {
  400: 'Imagem inválida ou grande demais.',
  403: 'Este endereço não tem permissão para ler fotos.',
  422: 'Não consegui ler a foto. Tente outra.',
  429: 'O limite gratuito de hoje acabou. Use a contagem manual.',
  502: 'O serviço de leitura falhou. Tente de novo.',
};

const photoDom = {
  button: document.querySelector('[data-action="open-photo"]'),
  input: document.getElementById('photo-input'),
  status: document.getElementById('photo-status'),
};

function showPhotoStatus(message, kind) {
  photoDom.status.textContent = message;
  photoDom.status.dataset.kind = kind || 'info';
  photoDom.status.hidden = false;
}

function setPhotoBusy(busy) {
  photoDom.button.disabled = busy;
  photoDom.button.querySelector('.photo-btn__label').textContent = busy ? 'Lendo foto...' : 'Enviar foto';
}

async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível reduzir a imagem.'))),
      'image/jpeg',
      PHOTO_JPEG_QUALITY,
    );
  });
}

async function requestRecognition(blob) {
  const response = await fetch(`${PHOTO_WORKER_URL}/reconhecer`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });

  if (!response.ok) {
    const error = new Error('Falha na leitura.');
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.quantidades || {};
}

function quantityInputs() {
  return Array.from(document.querySelectorAll('.denomination__input'));
}

function hasTypedQuantities() {
  return quantityInputs().some((input) => (parseInt(input.value, 10) || 0) > 0);
}

function fillQuantities(quantities) {
  quantityInputs().forEach((input) => {
    input.value = String(quantities[input.dataset.value] || 0);
  });
}

async function handlePhotoSelected(file) {
  setPhotoBusy(true);
  showPhotoStatus('Lendo a foto...', 'info');

  try {
    let blob;
    try {
      blob = await shrinkImage(file);
    } catch {
      showPhotoStatus('Não consegui abrir esse arquivo. Use uma imagem JPG ou PNG.', 'error');
      return;
    }

    const quantities = await requestRecognition(blob);

    if (hasTypedQuantities() && !window.confirm('Substituir as quantidades que você já digitou pelas da foto?')) {
      showPhotoStatus('Leitura cancelada. Nada foi alterado.', 'info');
      return;
    }

    fillQuantities(quantities);
    showPhotoStatus('Campos preenchidos pela foto. Confira antes de salvar.', 'success');
  } catch (error) {
    const message = error.status
      ? PHOTO_ERROR_MESSAGES[error.status] || 'Não foi possível ler a foto.'
      : 'Sem conexão com o serviço de leitura.';
    showPhotoStatus(message, 'error');
  } finally {
    setPhotoBusy(false);
  }
}

function initPhotoReading() {
  if (!photoDom.button || !photoDom.input || !photoDom.status) return;

  photoDom.button.addEventListener('click', () => {
    if (!PHOTO_WORKER_URL) {
      showPhotoStatus(
        'A leitura por foto ainda não foi configurada: publique a Worker (pasta worker/) e informe o endereço em leitura-foto.js.',
        'error',
      );
      return;
    }
    photoDom.input.click();
  });

  photoDom.input.addEventListener('change', () => {
    const [file] = photoDom.input.files;
    photoDom.input.value = '';
    if (file) handlePhotoSelected(file);
  });
}

initPhotoReading();
