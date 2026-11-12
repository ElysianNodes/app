'use strict';

const api = window.elysian;
const configureButton = document.getElementById('configure-passcode');
const removeButton = document.getElementById('remove-passcode');
const description = document.getElementById('passcode-description');
const rowStatus = document.getElementById('passcode-status');
const modal = document.getElementById('passcode-modal');
const dialog = modal && modal.querySelector('.passcode-dialog');
const modalStatus = document.getElementById('passcode-modal-status');
const modalBack = document.getElementById('passcode-modal-back');
const modalNext = document.getElementById('passcode-modal-next');
const currentStepEl = document.getElementById('passcode-step-current');
const newStepEl = document.getElementById('passcode-step-new');
const confirmStepEl = document.getElementById('passcode-step-confirm');
const removeStepEl = document.getElementById('passcode-step-remove');
const stepper = document.getElementById('passcode-stepper');
const marks = stepper ? Array.from(stepper.querySelectorAll('[data-step-mark]')) : [];
const currentInput = document.getElementById('current-passcode');
const newInput = document.getElementById('new-passcode');
const confirmInput = document.getElementById('confirm-passcode');
const removeInput = document.getElementById('remove-current-passcode');

let configured = false;
let mode = 'configure';
let step = 'new';
let currentValue = '';
let newValue = '';

function showError(message) {
  if (modalStatus) modalStatus.textContent = message;
  else if (rowStatus) rowStatus.textContent = message;
}

function updateRow(isConfigured) {
  configured = isConfigured;
  if (removeButton) removeButton.hidden = !configured;
  if (configureButton) configureButton.disabled = false;
  if (description) description.textContent = configured
    ? 'A passcode is required each time ElysianNodes opens.'
    : 'Protect ElysianNodes with a passcode when the app opens.';
}

function showStep(nextStep) {
  step = nextStep;
  if (currentStepEl) currentStepEl.hidden = step !== 'current';
  if (newStepEl) newStepEl.hidden = step !== 'new';
  if (confirmStepEl) confirmStepEl.hidden = step !== 'confirm';
  if (removeStepEl) removeStepEl.hidden = step !== 'remove';
  if (dialog && step !== 'remove') {
    const heading = step === 'new' ? 'passcode-new-heading'
      : step === 'confirm' ? 'passcode-confirm-heading' : 'passcode-modal-heading';
    dialog.setAttribute('aria-labelledby', heading);
  }
  const isRemove = mode === 'remove';
  if (stepper) stepper.hidden = isRemove;
  if (marks.length >= 3) {
    marks[0].hidden = !configured;
    if (marks[0].nextElementSibling) marks[0].nextElementSibling.hidden = !configured;
    marks[0].textContent = configured ? '01' : '';
    marks[1].textContent = configured ? '02' : '01';
    marks[2].textContent = configured ? '03' : '02';
    for (const mark of marks) {
      mark.classList.toggle('is-active', mark.dataset.stepMark === step);
      mark.classList.toggle('is-done', (step === 'new' && mark.dataset.stepMark === 'current') || (step === 'confirm' && ['current', 'new'].includes(mark.dataset.stepMark)));
    }
  }
  if (modalBack) modalBack.hidden = step === 'current' || step === 'remove' || (step === 'new' && !configured);
  if (modalNext) {
    const label = step === 'remove' ? 'Remove passcode' : step === 'confirm' ? 'Save passcode' : 'Continue';
    modalNext.replaceChildren(document.createTextNode(label));
    modalNext.classList.toggle('btn-danger', step === 'remove');
    if (step !== 'remove') {
      const arrow = document.createElement('span');
      arrow.textContent = step === 'confirm' ? ' ✓' : ' →';
      modalNext.append(arrow);
    }
  }
  const newKicker = document.getElementById('new-step-kicker');
  const confirmKicker = document.getElementById('confirm-step-kicker');
  if (newKicker) newKicker.textContent = configured ? 'STEP 2 OF 3' : 'STEP 1 OF 2';
  if (confirmKicker) confirmKicker.textContent = configured ? 'STEP 3 OF 3' : 'STEP 2 OF 2';
  if (modalStatus) modalStatus.textContent = '';
  requestAnimationFrame(() => {
    const input = step === 'current' ? currentInput : step === 'new' ? newInput : step === 'confirm' ? confirmInput : removeInput;
    input?.focus();
  });
}

function closeModal(successMessage = '') {
  if (modal) modal.hidden = true;
  currentValue = '';
  newValue = '';
  if (currentInput) currentInput.value = '';
  if (newInput) newInput.value = '';
  if (confirmInput) confirmInput.value = '';
  if (removeInput) removeInput.value = '';
  if (successMessage && rowStatus) rowStatus.textContent = successMessage;
}

function openModal(nextMode = 'configure') {
  if (!modal) {
    showError('Please update ElysianNodes to use passcode settings.');
    return;
  }
  mode = nextMode;
  currentValue = '';
  newValue = '';
  if (currentInput) currentInput.value = '';
  if (newInput) newInput.value = '';
  if (confirmInput) confirmInput.value = '';
  if (removeInput) removeInput.value = '';
  modal.hidden = false;
  showStep(mode === 'remove' ? 'remove' : configured ? 'current' : 'new');
}

configureButton?.addEventListener('click', () => openModal());
removeButton?.addEventListener('click', () => openModal('remove'));
document.getElementById('passcode-modal-close')?.addEventListener('click', () => closeModal());
modalBack?.addEventListener('click', () => {
  if (step === 'confirm') showStep('new');
  else if (step === 'new' && configured) showStep('current');
});
modal?.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal && !modal.hidden) closeModal();
});

modalNext?.addEventListener('click', async () => {
  modalNext.disabled = true;
  try {
    if (step === 'current') {
      const result = await api.verifyPasscode(currentInput.value);
      if (!result || !result.ok) {
        showError(result && result.retryAfterMs > 0 ? 'Too many attempts. Wait 30 seconds and try again.' : 'That passcode did not match. Try again.');
        currentInput.value = '';
        currentInput.focus();
        return;
      }
      currentValue = currentInput.value;
      showStep('new');
      return;
    }
    if (step === 'new') {
      if (newInput.value.length < 4 || newInput.value.length > 64) {
        showError('Use a passcode between 4 and 64 characters.');
        return;
      }
      newValue = newInput.value;
      showStep('confirm');
      return;
    }
    if (step === 'confirm') {
      if (confirmInput.value !== newValue) {
        showError('The passcodes do not match. Try again.');
        confirmInput.value = '';
        confirmInput.focus();
        return;
      }
      const result = await api.savePasscode({ currentPasscode: currentValue, passcode: newValue });
      if (!result || !result.ok) {
        showError((result && result.error) || 'Could not save passcode.');
        return;
      }
      updateRow(true);
      closeModal('Passcode saved. It will be required the next time the app opens.');
      return;
    }
    if (step === 'remove') {
      const result = await api.removePasscode({ currentPasscode: removeInput.value });
      if (!result || !result.ok) {
        showError((result && result.error) || 'Could not remove passcode.');
        removeInput.value = '';
        removeInput.focus();
        return;
      }
      updateRow(false);
      closeModal('Passcode removed.');
    }
  } catch {
    showError('Could not update passcode settings. Please try again.');
  } finally {
    modalNext.disabled = false;
  }
});

if (configureButton) configureButton.disabled = true;
if (typeof api.getPasscodeState === 'function') {
  api.getPasscodeState().then((state) => updateRow(Boolean(state && state.configured)))
    .catch(() => {
      if (configureButton) configureButton.disabled = false;
      showError('Could not load passcode settings.');
    });
} else {
  if (configureButton) configureButton.disabled = false;
  showError('Please update ElysianNodes to use passcode settings.');
}
