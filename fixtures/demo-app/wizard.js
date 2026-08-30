const TOTAL = 10;
let step = 1;

function getStepFromUrl() {
  const params = new URLSearchParams(location.search);
  return Math.min(TOTAL, Math.max(1, parseInt(params.get('step') || '1', 10)));
}

function render() {
  step = getStepFromUrl();
  document.getElementById('step-indicator').textContent = `Etapa ${step} de ${TOTAL}`;
  document.getElementById('wizard-title').textContent = `Modal — Dados financeiros — etapa ${step}/${TOTAL}`;
  document.getElementById('step-content').innerHTML = `
    <label for="field-step">Campo etapa ${step}</label>
    <input id="field-step" type="text" name="fieldStep${step}" aria-label="Campo etapa ${step}" />
    <p>Dados específicos da etapa ${step}</p>
  `;
  document.getElementById('prev-btn').disabled = step <= 1;
  document.getElementById('next-btn').textContent = step >= TOTAL ? 'Concluir' : 'Próximo';
}

document.getElementById('next-btn').addEventListener('click', () => {
  if (step >= TOTAL) {
    history.pushState({}, '', 'detail.html');
    location.href = 'detail.html';
  } else {
    const next = step + 1;
    history.pushState({ step: next }, '', `wizard.html?step=${next}`);
    step = next;
    render();
  }
});

document.getElementById('prev-btn').addEventListener('click', () => {
  if (step > 1) {
    const prev = step - 1;
    history.pushState({ step: prev }, '', `wizard.html?step=${prev}`);
    step = prev;
    render();
  }
});

window.addEventListener('popstate', render);
render();
