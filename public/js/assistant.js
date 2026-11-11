// AI Assistant — embeds the Amazon Quick agent via iframe.
// If QUICK_EMBED_URL is not configured on the server, shows a clear message
// instead of a broken frame.

const Assistant = (() => {
  let isOpen = false;
  let loaded = false;

  function init() {
    const toggle = document.getElementById('assistantToggle');
    const minimize = document.getElementById('assistantMinimize');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
      isOpen = !isOpen;
      updatePanel();
      if (isOpen && !loaded) { loaded = true; loadAssistant(); }
    });
    if (minimize) minimize.addEventListener('click', () => { isOpen = false; updatePanel(); });
  }

  function updatePanel() {
    const panel = document.getElementById('assistantPanel');
    if (panel) panel.classList.toggle('open', isOpen);
  }

  async function loadAssistant() {
    const body = document.getElementById('assistantBody');
    if (!body) return;
    try {
      const res = await fetch('/api/assistant/config');
      const cfg = await res.json();
      if (cfg.configured && cfg.embedUrl) {
        body.innerHTML =
          `<iframe class="assistant-iframe" src="${cfg.embedUrl}" ` +
          `title="AI Assistant" allow="clipboard-write; microphone"></iframe>`;
      } else {
        body.innerHTML = notConfiguredHtml();
      }
    } catch (err) {
      body.innerHTML = `<div class="assistant-msg">Could not load the assistant. Please try again.</div>`;
    }
  }

  function notConfiguredHtml() {
    return `
      <div class="assistant-msg">
        <div class="assistant-msg-icon">🤖</div>
        <div class="assistant-msg-title">Assistant not configured yet</div>
        <div class="assistant-msg-text">
          The Amazon Quick AI agent hasn't been connected. Once your AWS team deploys the
          Quick embedding and provides the URL, set <code>QUICK_EMBED_URL</code> in the
          server <code>.env</code> and it will appear here.
        </div>
      </div>`;
  }

  return { init };
})();
