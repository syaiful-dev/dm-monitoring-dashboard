// DM Monitoring Dashboard — Chatbot UI
// Floating panel with message bubbles, typing indicator, suggestions

const Chatbot = (() => {
  let isOpen = false;
  let unreadCount = 0;

  function init() {
    const toggle = document.getElementById('chatbotToggle');
    const minimize = document.getElementById('chatbotMinimize');
    const input = document.getElementById('chatbotInput');
    const sendBtn = document.getElementById('chatbotSend');

    // Toggle panel
    toggle.addEventListener('click', () => {
      isOpen = !isOpen;
      updatePanel();
      if (isOpen) {
        unreadCount = 0;
        updateBadge();
        input.focus();
      }
    });

    // Minimize
    minimize.addEventListener('click', () => {
      isOpen = false;
      updatePanel();
    });

    // Send message
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Welcome message
    addBotMessage(
      '👋 Hi! I\'m DM Assistant. I can help you monitor your data pipelines.\n\nTry asking "What\'s the status today?" or type "help" for more options.',
      ['Status today', 'Active alerts', 'Any anomalies?', 'help']
    );
  }

  function updatePanel() {
    const panel = document.getElementById('chatbotPanel');
    panel.classList.toggle('open', isOpen);
  }

  async function sendMessage() {
    const input = document.getElementById('chatbotInput');
    const message = input.value.trim();
    if (!message) return;

    // Show user message
    addUserMessage(message);
    input.value = '';

    // Show typing indicator
    showTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });

      const data = await res.json();
      hideTyping();
      addBotMessage(data.reply, data.suggestions);
    } catch (err) {
      hideTyping();
      addBotMessage('Sorry, I encountered an error. Please try again.', ['help']);
    }
  }

  function addUserMessage(text) {
    const container = document.getElementById('chatbotMessages');
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.className = 'chat-message user';
    div.innerHTML = `
      <div class="chat-bubble">${escapeHtml(text)}</div>
      <span class="chat-timestamp">${time}</span>
    `;
    container.appendChild(div);
    scrollToBottom();
  }

  function addBotMessage(text, suggestions = []) {
    const container = document.getElementById('chatbotMessages');
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.className = 'chat-message bot';
    div.innerHTML = `
      <div class="chat-bubble">${formatBotMessage(text)}</div>
      <span class="chat-timestamp">${time}</span>
    `;
    container.appendChild(div);
    scrollToBottom();

    // Update suggestions
    renderSuggestions(suggestions);

    // Increment badge if panel is closed
    if (!isOpen) {
      incrementBadge();
    }
  }

  function formatBotMessage(text) {
    // Convert markdown-like bold **text** to HTML
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderSuggestions(suggestions) {
    const container = document.getElementById('chatbotSuggestions');
    if (!container) return;

    if (!suggestions || suggestions.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = suggestions.map(s =>
      `<button class="suggestion-btn">${escapeHtml(s)}</button>`
    ).join('');

    // Click handlers
    container.querySelectorAll('.suggestion-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('chatbotInput');
        input.value = btn.textContent;
        sendMessage();
      });
    });
  }

  function showTyping() {
    const container = document.getElementById('chatbotMessages');
    const div = document.createElement('div');
    div.className = 'chat-message bot';
    div.id = 'typingIndicator';
    div.innerHTML = `
      <div class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    `;
    container.appendChild(div);
    scrollToBottom();
  }

  function hideTyping() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
  }

  function scrollToBottom() {
    const container = document.getElementById('chatbotMessages');
    container.scrollTop = container.scrollHeight;
  }

  function incrementBadge() {
    if (!isOpen) {
      unreadCount++;
      updateBadge();
    }
  }

  function updateBadge() {
    const badge = document.getElementById('chatbotBadge');
    if (badge) {
      if (unreadCount > 0) {
        badge.style.display = 'flex';
        badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      } else {
        badge.style.display = 'none';
      }
    }
  }

  return { init, incrementBadge };
})();
