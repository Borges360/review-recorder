let count = 0;
setInterval(() => {
  count += 1;
  const el = document.getElementById('counter');
  if (el) el.textContent = String(count);
}, 1000);

setInterval(() => {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.classList.toggle('hidden');
  }
}, 5000);
