navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((stream) => {
    stream.getTracks().forEach((track) => track.stop());
    void chrome.runtime.sendMessage({ type: 'mic-granted' });
    document.body.textContent = 'Microfone permitido. Esta aba pode ser fechada.';
    window.close();
  })
  .catch((error: unknown) => {
    document.body.textContent = `Não foi possível acessar o microfone: ${String(error)}`;
  });
