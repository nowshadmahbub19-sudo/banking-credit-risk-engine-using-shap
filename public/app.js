'use strict';

// Forma Credit Risk Studio — framework-free frontend.
// All predictions are fetched from the real FastAPI endpoint. No mock risk scores.
const $ = (selector) => document.querySelector(selector);
const form = $('#risk-form');
const resultsCard = $('#results-card');
const meter = $('#meter-progress');
const meterValue = $('#meter-value');
const meterPercent = $('#meter-percent');
const fields = [...form.querySelectorAll('input, select')];
const editableFields = fields.filter((field) => !field.readOnly);
const ratioField = $('#loan_percent_income');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const circumference = 2 * Math.PI * 91;
let priorResult = false;
let showingSample = false;
let resultAnimationFrame = null;
let toastTimer = null;

function amount(value) {
  const num = Number(value);
  return value !== '' && Number.isFinite(num)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
    : '—';
}

function numericValue(id) {
  const value = $(id).value.trim();
  return value === '' ? null : Number(value);
}

function updateRatio() {
  const income = numericValue('#person_income');
  const loan = numericValue('#loan_amnt');
  const ratio = income > 0 && loan > 0 ? loan / income : null;
  ratioField.value = ratio === null || !Number.isFinite(ratio) ? '' : ratio.toFixed(4);
  $('#ratio-percent').textContent = ratio === null ? '—' : `${(ratio * 100).toFixed(1)}%`;
  return ratio;
}

function updateSnapshot() {
  const income = $('#person_income').value;
  const loan = $('#loan_amnt').value;
  const ratio = updateRatio();
  $('#snapshot-income').textContent = amount(income);
  $('#snapshot-loan').textContent = amount(loan);
  $('#snapshot-ratio').textContent = ratio !== null ? `${(ratio * 100).toFixed(1)}%` : '—';
  $('#snapshot-grade').textContent = $('#loan_grade').value || '—';

  const completed = editableFields.filter((field) => field.value.trim() !== '' && field.checkValidity()).length;
  const count = editableFields.length;
  $('#completion-count').textContent = `${completed} of ${count} filled in`;
  $('#form-progress-bar').style.width = `${(completed / count) * 100}%`;
  $('#form-progress-bar').parentElement.setAttribute('aria-valuenow', String(completed));
  $('#submit-btn').classList.toggle('is-ready', completed === count);
}

function clearFieldError(field) {
  const wrapper = field.closest('.field');
  if (!wrapper) return;
  wrapper.classList.remove('invalid');
  const error = wrapper.querySelector('.field-error');
  if (error) error.textContent = '';
  field.removeAttribute('aria-invalid');
}

function errorFor(field) {
  if (!field.value.trim()) return 'This field is required.';
  if (field.validity.rangeUnderflow) return `Must be at least ${field.min}.`;
  if (field.validity.rangeOverflow) return `Must be no more than ${field.max}.`;
  if (field.validity.stepMismatch) return 'Please enter a valid increment.';
  if (field.validity.badInput || !field.checkValidity()) return 'Please enter a valid value.';
  return '';
}

function validateAll() {
  let firstInvalid = null;
  editableFields.forEach((field) => {
    const error = errorFor(field);
    const wrapper = field.closest('.field');
    const errorElement = wrapper?.querySelector('.field-error');
    if (error) {
      wrapper?.classList.add('invalid');
      if (errorElement) errorElement.textContent = error;
      field.setAttribute('aria-invalid', 'true');
      if (!firstInvalid) firstInvalid = field;
    } else {
      clearFieldError(field);
    }
  });
  if (!ratioField.value && !firstInvalid) firstInvalid = $('#person_income');
  if (firstInvalid) {
    firstInvalid.focus({ preventScroll: true });
    firstInvalid.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
    toast('Just a few details left. Check the highlighted fields to continue.');
    return false;
  }
  return true;
}

function restoreResult() {
  if (resultAnimationFrame) cancelAnimationFrame(resultAnimationFrame);
  priorResult = false;
  resultsCard.classList.remove('high-risk', 'low-risk');
  $('#result-state').className = 'result-state';
  $('#result-state').innerHTML = '<span class="state-dot"></span> READY WHEN YOU ARE';
  meter.style.strokeDashoffset = String(circumference);
  meterValue.firstChild.textContent = '—';
  meterPercent.textContent = '';
  $('#meter-foot').textContent = 'No result yet';
  $('#result-title').textContent = 'Your result will appear here';
  $('#result-description').textContent = 'Fill in the details and click “See loan risk” to get an estimate.';
  $('#result-message .result-icon').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>';
  $('#threshold-area').hidden = true;
  $('#threshold-area').open = false;
}

function toast(message) {
  const element = $('#toast');
  $('#toast-message').textContent = message;
  element.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 5500);
}
$('#toast-close').addEventListener('click', () => $('#toast').classList.remove('show'));

function setLoading(loading) {
  $('#submit-btn').disabled = loading;
  $('#submit-btn').setAttribute('aria-busy', String(loading));
  $('#submit-label').textContent = loading ? 'Checking the loan…' : 'See loan risk';
  $('#submit-arrow').hidden = loading;
  $('#button-spinner').hidden = !loading;
}

function animateProbability(value) {
  if (resultAnimationFrame) cancelAnimationFrame(resultAnimationFrame);
  const target = Math.max(0, Math.min(1, value));
  if (reducedMotion.matches) {
    meter.style.strokeDashoffset = String(circumference * (1 - target));
    meterValue.firstChild.textContent = (target * 100).toFixed(1);
    return;
  }
  const duration = 1400;
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 4);
    meterValue.firstChild.textContent = (target * 100 * eased).toFixed(1);
    // CSS handles the arc animation separately for smoother rendering.
    if (progress < 1) resultAnimationFrame = requestAnimationFrame(tick);
  };
  meter.style.strokeDashoffset = String(circumference * (1 - target));
  resultAnimationFrame = requestAnimationFrame(tick);
}

function renderPrediction(data) {
  const probability = Number(data.default_probability);
  const threshold = Number(data.threshold);
  const prediction = Number(data.default_prediction);
  if (![probability, threshold, prediction].every(Number.isFinite) || probability < 0 || probability > 1 || threshold < 0 || threshold > 1 || ![0, 1].includes(prediction)) {
    throw new Error('The API returned an invalid prediction response.');
  }
  const highRisk = prediction === 1;
  restoreResult();
  priorResult = true;
  resultsCard.classList.add(highRisk ? 'high-risk' : 'low-risk');
  $('#result-state').className = `result-state ${highRisk ? 'negative' : 'positive'}`;
  $('#result-state').innerHTML = `<span class="state-dot"></span> ${highRisk ? 'HIGH RISK' : 'LOW RISK'}`;
  meterPercent.textContent = '%';
  $('#meter-foot').textContent = 'Model estimate, not a guarantee';
  $('#result-title').textContent = highRisk ? 'Higher risk of non-repayment' : 'Lower risk of non-repayment';
  $('#result-description').textContent = highRisk
    ? `${showingSample ? 'In this example, ' : ''}the model flags a higher risk that this loan will not be repaid as agreed. It is not a certainty.`
    : `${showingSample ? 'In this example, ' : ''}the model flags a lower risk that this loan will not be repaid as agreed. Repayment is not guaranteed.`;
  $('#result-message .result-icon').innerHTML = highRisk
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 17h.01"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>';
  $('#threshold-area').hidden = false;
  $('#threshold-value').textContent = `${(threshold * 100).toFixed(1)}%`;
  // Marker is the model's decision boundary; colored fill is probability.
  $('#threshold-marker').style.left = `${threshold * 100}%`;
  $('#threshold-fill').style.width = `${probability * 100}%`;
  animateProbability(probability);
  resultsCard.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'nearest' });
}

async function checkConnection() {
  const card = $('#connection-card');
  card.classList.remove('is-ready', 'is-error');
  $('#connection-title').textContent = 'Checking the service';
  $('#connection-detail').textContent = 'Making sure the loan checker is ready…';
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('Server is unavailable');
    const health = await response.json();
    if (health.model_loaded === true) {
      card.classList.add('is-ready');
      $('#connection-title').textContent = 'Ready to check a loan';
      $('#connection-detail').textContent = 'The risk checker is working.';
    } else {
      card.classList.add('is-error');
      $('#connection-title').textContent = 'Risk checker temporarily unavailable';
      $('#connection-detail').textContent = 'The site owner needs to connect the prediction model.';
    }
  } catch (_error) {
    card.classList.add('is-error');
    $('#connection-title').textContent = 'Risk checker is offline';
    $('#connection-detail').textContent = 'Please try again later.';
  }
}

function getPayload() {
  const data = Object.fromEntries(new FormData(form).entries());
  const integers = ['person_age', 'cb_person_cred_hist_length'];
  const numbers = ['person_income', 'person_emp_length', 'loan_amnt', 'loan_int_rate'];
  for (const key of integers) data[key] = Number.parseInt(data[key], 10);
  for (const key of numbers) data[key] = Number(data[key]);
  data.loan_percent_income = data.loan_amnt / data.person_income;
  return data;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  updateSnapshot();
  if (!validateAll()) return;
  setLoading(true);
  try {
    const response = await fetch('/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getPayload())
    });
    let data;
    try { data = await response.json(); } catch (_error) { throw new Error('The service returned an unreadable response.'); }
    if (!response.ok) {
      const detail = data?.detail;
      const message = typeof detail === 'string' ? detail : 'Prediction failed. Check your inputs and model configuration.';
      throw new Error(message);
    }
    renderPrediction(data);
  } catch (error) {
    toast(error.message || 'Could not check the loan right now. Please try again.');
    checkConnection();
  } finally {
    setLoading(false);
  }
});

editableFields.forEach((field) => {
  const handler = () => {
    clearFieldError(field);
    if (showingSample) {
      showingSample = false;
      $('#example-notice').hidden = true;
    }
    updateSnapshot();
    if (priorResult) restoreResult();
  };
  field.addEventListener('input', handler);
  field.addEventListener('change', handler);
});

// Example values are clearly labeled. The example result still comes from /predict.
function loadSample({ predict = false } = {}) {
  const sample = {
    person_age: '29', person_income: '68000', person_home_ownership: 'RENT', person_emp_length: '5',
    loan_intent: 'EDUCATION', loan_grade: 'B', loan_amnt: '12000', loan_int_rate: '10.9',
    cb_person_default_on_file: 'N', cb_person_cred_hist_length: '7'
  };
  Object.entries(sample).forEach(([key, value]) => {
    const field = document.getElementById(key);
    field.value = value;
    clearFieldError(field);
  });
  showingSample = true;
  $('#example-notice').hidden = false;
  updateSnapshot();
  restoreResult();
  if (predict) {
    form.requestSubmit();
  } else {
    $('#assessment').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    toast('Example details are ready. Click “See loan risk” to view the model’s result.');
  }
}

function clearApplication() {
  showingSample = false;
  $('#example-notice').hidden = true;
  form.reset();
  editableFields.forEach(clearFieldError);
  ratioField.value = '';
  $('#ratio-percent').textContent = '—';
  updateSnapshot();
  restoreResult();
}

$('#sample-btn').addEventListener('click', () => loadSample());
$('#hero-sample-btn').addEventListener('click', () => loadSample({ predict: true }));
$('#reset-btn').addEventListener('click', () => {
  clearApplication();
  toast('Form cleared. You can start again.');
});
$('#example-clear-btn').addEventListener('click', clearApplication);

$('#retry-connection').addEventListener('click', checkConnection);
const mobileToggle = $('#menu-toggle');
const backdrop = $('#mobile-backdrop');
function closeMobileMenu() {
  $('#sidebar').classList.remove('is-open');
  mobileToggle.setAttribute('aria-expanded', 'false');
  backdrop.hidden = true;
}
mobileToggle.addEventListener('click', () => {
  const opened = $('#sidebar').classList.toggle('is-open');
  mobileToggle.setAttribute('aria-expanded', String(opened));
  backdrop.hidden = !opened;
});
backdrop.addEventListener('click', closeMobileMenu);
$('.side-nav').querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMobileMenu));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMobileMenu(); });

// Starting state: no model output is ever guessed or fabricated.
updateSnapshot();
restoreResult();
checkConnection();
