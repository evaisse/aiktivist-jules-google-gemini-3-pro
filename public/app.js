// Main Application State & Router
const app = document.getElementById("app");
let currentUser = null;
let currentConversationId = null;
let eventSource = null;
let isStreaming = false;

// Views
const VIEWS = {
  LOGIN: "LOGIN",
  APP: "APP",
};

export async function init() {
  await fetchUser();
  handleRoute();
  window.addEventListener("popstate", handleRoute);

  // Intercept links
  document.body.addEventListener("click", (e) => {
    if (e.target.matches("a[data-link]")) {
      e.preventDefault();
      navigateTo(e.target.getAttribute("href"));
    }
  });
}

export async function fetchUser() {
  try {
    const res = await fetch("/api/me");
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
    } else {
      currentUser = null;
    }
  } catch {
    currentUser = null;
  }
}

export function navigateTo(url) {
  history.pushState(null, null, url);
  handleRoute();
}

export function handleRoute() {
  const path = window.location.pathname;

  if (!currentUser) {
    if (path !== "/login" && path !== "/register") {
      history.replaceState(null, null, "/login");
    }
    renderAuth(path === "/register" ? "register" : "login");
    return;
  }

  if (path === "/login" || path === "/register") {
    history.replaceState(null, null, "/");
  }

  const match = path.match(/^\/c\/([^/]+)$/);
  currentConversationId = match ? match[1] : null;

  renderApp();
}

function renderAuth(type) {
  app.innerHTML = `
    <div class="auth-container">
      <h2>${type === "login" ? "Login" : "Register"}</h2>
      <form id="auth-form">
        <input type="text" id="username" placeholder="Username" required autofocus autocomplete="off" />
        <input type="password" id="password" placeholder="Password" required />
        <button type="submit">${type === "login" ? "Login" : "Register"}</button>
      </form>
      <div style="margin-top: 1rem; text-align: center; font-size: 0.9em;">
        ${type === "login"
          ? 'No account? <a href="/register" data-link>Register here</a>'
          : 'Already have an account? <a href="/login" data-link>Login here</a>'}
      </div>
      <div id="auth-error" style="color: red; margin-top: 1rem; text-align: center;"></div>
    </div>
  `;

  const form = document.getElementById("auth-form");
  const errorDiv = document.getElementById("auth-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = form.username.value;
    const password = form.password.value;

    try {
      const res = await fetch(`/api/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (!res.ok) {
        errorDiv.textContent = data.error || "An error occurred";
      } else {
        if (type === "register") {
          navigateTo("/login");
        } else {
          await fetchUser();
          navigateTo("/");
        }
      }
    } catch (err) {
      errorDiv.textContent = "Network error";
    }
  });
}

async function handleLogout() {
  await fetch("/api/logout", { method: "POST" });
  currentUser = null;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  navigateTo("/login");
}

function renderApp() {
  app.innerHTML = `
    <div class="layout">
      <div class="sidebar">
        <div class="sidebar-header">
          <span style="font-weight:bold;">Aiktivist</span>
          <button id="btn-new-chat">+ New</button>
        </div>
        <ul id="conv-list" class="conv-list">
          <!-- Populated by JS -->
        </ul>
        <div class="sidebar-header" style="border-top: 1px solid var(--border-subtle); border-bottom: none;">
          <span style="font-size: 0.8rem; color: var(--fg-muted)">${currentUser.username}</span>
          <button id="btn-logout" style="font-size: 0.8rem;">Logout</button>
        </div>
      </div>
      <div class="main-view">
        <div id="main-header" class="main-header">
           Select or create a conversation
        </div>
        <div id="messages" class="messages">
          <!-- Populated by JS -->
        </div>
        <div class="input-area" id="input-area" style="display: none;">
          <form id="msg-form">
            <input type="text" id="msg-input" placeholder="Type a message..." autocomplete="off" />
            <button type="submit" id="msg-submit" style="padding: 0 1rem; border: 1px solid var(--border-subtle)">Send</button>
          </form>
        </div>
      </div>
    </div>
  `;

  document.getElementById("btn-logout").addEventListener("click", handleLogout);

  document.getElementById("btn-new-chat").addEventListener("click", async () => {
    const res = await fetch("/api/conversations", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      navigateTo(`/c/${data.conversation.id}`);
    }
  });

  loadConversations();
  if (currentConversationId) {
    loadConversation(currentConversationId);
  } else {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }
}

async function loadConversations() {
  const res = await fetch("/api/conversations");
  if (!res.ok) return;
  const data = await res.json();
  const list = document.getElementById("conv-list");
  list.innerHTML = "";

  data.conversations.forEach((c) => {
    const li = document.createElement("li");
    li.className = `conv-item ${c.id === currentConversationId ? "active" : ""}`;

    const link = document.createElement("a");
    link.href = `/c/${c.id}`;
    link.setAttribute("data-link", "true");
    link.textContent = c.title || "Nouvelle conversation";

    const actions = document.createElement("div");
    actions.className = "conv-actions";

    const delBtn = document.createElement("button");
    delBtn.innerHTML = "&times;";
    delBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await fetch(`/api/conversations/${c.id}`, { method: "DELETE" });
      if (c.id === currentConversationId) {
        navigateTo("/");
      } else {
        loadConversations();
      }
    };
    actions.appendChild(delBtn);

    li.appendChild(link);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

async function loadConversation(id) {
  const header = document.getElementById("main-header");
  const messagesDiv = document.getElementById("messages");
  const inputArea = document.getElementById("input-area");
  const form = document.getElementById("msg-form");
  const input = document.getElementById("msg-input");

  header.innerHTML = "Loading...";
  messagesDiv.innerHTML = "";
  inputArea.style.display = "none";

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  const res = await fetch(`/api/conversations/${id}`);
  if (!res.ok) {
    header.innerHTML = "Conversation not found";
    return;
  }

  const data = await res.json();
  header.innerHTML = data.conversation.title || "Nouvelle conversation";

  data.messages.forEach(msg => appendMessage(msg));
  scrollToBottom();

  inputArea.style.display = "block";
  setupSSE(id);

  // Clean old listener
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);

  newForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isStreaming) return;

    const content = newForm.querySelector("#msg-input").value.trim();
    if (!content) return;

    newForm.querySelector("#msg-input").value = "";

    // Optimistic UI for User Message
    // Handled purely by SSE to keep single source of truth, or immediately render it here.
    // SSE is better for single source of truth, but rendering immediately feels faster.

    await fetch(`/api/conversations/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  });

  newForm.querySelector("#msg-input").focus();
}

function appendMessage(msg) {
  const messagesDiv = document.getElementById("messages");
  const existing = document.getElementById(`msg-${msg.id}`);
  if (existing) return;

  const div = document.createElement("div");
  div.id = `msg-${msg.id}`;
  div.className = `msg msg-${msg.role}`;
  div.textContent = msg.content;
  messagesDiv.appendChild(div);
  scrollToBottom();
}

function setupSSE(id) {
  eventSource = new EventSource(`/api/conversations/${id}/events`);

  eventSource.onmessage = (e) => {
    // skip keepalive
    if (e.data === ": keepalive") return;

    try {
      const event = JSON.parse(e.data);
      handleAppEvent(event);
    } catch (err) {
      console.error("SSE Parse error", err);
    }
  };

  eventSource.onerror = () => {
    console.error("SSE Error, reconnecting...");
  };
}

function handleAppEvent(event) {
  const messagesDiv = document.getElementById("messages");

  if (event.type === "system") {
    // Internal
  } else if (event.type === "thinking") {
    isStreaming = true;
    let thinkingDiv = document.getElementById("thinking-indicator");
    if (!thinkingDiv) {
      thinkingDiv = document.createElement("div");
      thinkingDiv.id = "thinking-indicator";
      thinkingDiv.className = "msg thinking";
      thinkingDiv.textContent = "Agent: Thinking...";
      messagesDiv.appendChild(thinkingDiv);
      scrollToBottom();
    }
  } else if (event.type === "user_message") {
    appendMessage(event.payload);
  } else if (event.type === "assistant_chunk") {
    const thinkingDiv = document.getElementById("thinking-indicator");
    if (thinkingDiv) thinkingDiv.remove();

    let activeDiv = document.getElementById(`msg-${event.payload.id}`);
    if (!activeDiv) {
      activeDiv = document.createElement("div");
      activeDiv.id = `msg-${event.payload.id}`;
      activeDiv.className = "msg msg-assistant";
      messagesDiv.appendChild(activeDiv);
    }

    activeDiv.textContent += event.payload.chunk;
    scrollToBottom();
  } else if (event.type === "assistant_done") {
    isStreaming = false;
    // Overwrite with full content to fix any missed chunks
    let activeDiv = document.getElementById(`msg-${event.payload.id}`);
    if (activeDiv) {
      activeDiv.textContent = event.payload.fullContent;
    } else {
      appendMessage({ id: event.payload.id, role: "assistant", content: event.payload.fullContent });
    }
    scrollToBottom();
  } else if (event.type === "error") {
    isStreaming = false;
    const thinkingDiv = document.getElementById("thinking-indicator");
    if (thinkingDiv) thinkingDiv.remove();

    const div = document.createElement("div");
    div.className = "msg msg-system";
    div.textContent = `Error: ${event.payload.message}`;
    messagesDiv.appendChild(div);
    scrollToBottom();
  }
}

function scrollToBottom() {
  const messagesDiv = document.getElementById("messages");
  if (messagesDiv) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
}

init();
