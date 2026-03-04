import { serve } from "bun";
import { resolve } from "path";

const PORT = process.env.PORT || 3000;

function jsonResponse(data: any, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function serveStatic(url: URL): Response | null {
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(process.cwd(), "public", `.${path}`);

  const file = Bun.file(filePath);
  if (file.size > 0) {
    return new Response(file);
  }

  // SPA fallback
  if (!url.pathname.startsWith("/api/")) {
     const indexFile = Bun.file(resolve(process.cwd(), "public", "index.html"));
     return new Response(indexFile);
  }
  return null;
}

const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Logging all requests
    console.log(`${req.method} ${url.pathname}`);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    try {
      // Route Handlers
      if (url.pathname === "/api/register" && req.method === "POST") {
        const body = await req.json();
        const { username, password } = body;

        if (!username || !password) return jsonResponse({ error: "Missing fields" }, 400);

        const { db } = await import("./db");
        const { generateId, hashPassword } = await import("./auth");

        const existingUser = db.query("SELECT id FROM users WHERE username = ?").get(username);
        if (existingUser) return jsonResponse({ error: "Username taken" }, 409);

        const userId = generateId();
        const pwdHash = await hashPassword(password);

        db.run("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)", [userId, username, pwdHash]);

        return jsonResponse({ message: "User registered" }, 201);
      }

      if (url.pathname === "/api/login" && req.method === "POST") {
        const body = await req.json();
        const { username, password } = body;

        if (!username || !password) return jsonResponse({ error: "Missing fields" }, 400);

        const { db } = await import("./db");
        const { verifyPassword, createSession } = await import("./auth");

        const user = db.query("SELECT id, password_hash FROM users WHERE username = ?").get(username) as any;
        if (!user) return jsonResponse({ error: "Invalid credentials" }, 401);

        const isValid = await verifyPassword(password, user.password_hash);
        if (!isValid) return jsonResponse({ error: "Invalid credentials" }, 401);

        const sessionId = createSession(user.id);

        return jsonResponse({ message: "Login successful" }, 200, {
          "Set-Cookie": `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`,
        });
      }

      if (url.pathname === "/api/logout" && req.method === "POST") {
        const { getSessionIdFromRequest, deleteSession } = await import("./auth");
        const sessionId = getSessionIdFromRequest(req);
        if (sessionId) {
          deleteSession(sessionId);
        }

        return jsonResponse({ message: "Logout successful" }, 200, {
          "Set-Cookie": `session_id=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
        });
      }

      if (url.pathname === "/api/me" && req.method === "GET") {
        const { getSessionIdFromRequest, getUserIdFromSession } = await import("./auth");
        const { db } = await import("./db");

        const sessionId = getSessionIdFromRequest(req);
        if (!sessionId) return jsonResponse({ user: null }, 200);

        const userId = getUserIdFromSession(sessionId);
        if (!userId) return jsonResponse({ user: null }, 200);

        const user = db.query("SELECT id, username FROM users WHERE id = ?").get(userId);
        return jsonResponse({ user }, 200);
      }

      // Conversations CRUD
      if (url.pathname.startsWith("/api/conversations")) {
        const { getSessionIdFromRequest, getUserIdFromSession, generateId } = await import("./auth");
        const { db } = await import("./db");

        const sessionId = getSessionIdFromRequest(req);
        if (!sessionId) return jsonResponse({ error: "Unauthorized" }, 401);

        const userId = getUserIdFromSession(sessionId);
        if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

        // GET /api/conversations
        if (url.pathname === "/api/conversations" && req.method === "GET") {
          const conversations = db.query(`
            SELECT id, title, status, created_at, updated_at
            FROM conversations
            WHERE user_id = ? AND status != 'deleted'
            ORDER BY updated_at DESC
          `).all(userId);

          return jsonResponse({ conversations }, 200);
        }

        // POST /api/conversations
        if (url.pathname === "/api/conversations" && req.method === "POST") {
          const body = await req.json().catch(() => ({}));
          const title = body.title || "Nouvelle conversation";

          const conversationId = generateId();
          db.run(
            "INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)",
            [conversationId, userId, title]
          );

          const conversation = db.query("SELECT * FROM conversations WHERE id = ?").get(conversationId);
          return jsonResponse({ conversation }, 201);
        }

        // GET /api/conversations/:id
        const idMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
        if (idMatch && req.method === "GET") {
          const conversationId = idMatch[1];
          const conversation = db.query(`
            SELECT id, title, status, created_at, updated_at
            FROM conversations
            WHERE id = ? AND user_id = ? AND status != 'deleted'
          `).get(conversationId, userId);

          if (!conversation) return jsonResponse({ error: "Not found" }, 404);

          const messages = db.query(`
            SELECT id, role, content, created_at
            FROM messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC
          `).all(conversationId);

          return jsonResponse({ conversation, messages }, 200);
        }

        // DELETE /api/conversations/:id (Soft delete)
        if (idMatch && req.method === "DELETE") {
          const conversationId = idMatch[1];
          const result = db.run(
            "UPDATE conversations SET status = 'deleted' WHERE id = ? AND user_id = ?",
            [conversationId, userId]
          );

          if (result.changes === 0) return jsonResponse({ error: "Not found or forbidden" }, 404);

          return jsonResponse({ message: "Conversation deleted" }, 200);
        }

        // POST /api/conversations/:id/messages
        const msgMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
        if (msgMatch && req.method === "POST") {
          const conversationId = msgMatch[1];

          const conversation = db.query(`
            SELECT id FROM conversations WHERE id = ? AND user_id = ? AND status != 'deleted'
          `).get(conversationId, userId);
          if (!conversation) return jsonResponse({ error: "Not found" }, 404);

          const body = await req.json().catch(() => ({}));
          const content = body.content;
          if (!content) return jsonResponse({ error: "Missing content" }, 400);

          const messageId = generateId();
          db.run(
            "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)",
            [messageId, conversationId, "user", content]
          );

          // Update conversation timestamp
          db.run(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [conversationId]
          );

          const { broadcastEvent } = await import("./events");
          await broadcastEvent(conversationId, {
            type: "user_message",
            payload: { id: messageId, content, role: "user" },
          });

          // Trigger AI asynchronously
          const { processConversationAI } = await import("./ai");
          processConversationAI(conversationId).catch(console.error);

          return jsonResponse({ message: "Message added", id: messageId }, 201);
        }

        // GET /api/conversations/:id/events (SSE endpoint)
        const eventsMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/events$/);
        if (eventsMatch && req.method === "GET") {
          const conversationId = eventsMatch[1];

          const conversation = db.query(`
            SELECT id FROM conversations WHERE id = ? AND user_id = ? AND status != 'deleted'
          `).get(conversationId, userId);
          if (!conversation) return jsonResponse({ error: "Not found" }, 404);

          const { addClient, removeClient } = await import("./events");

          const body = new ReadableStream({
            start(controller) {
              addClient(conversationId, controller);

              const encoder = new TextEncoder();
              const connectedMsg = `data: ${JSON.stringify({ type: "system", payload: { connected: true } })}\n\n`;
              controller.enqueue(encoder.encode(connectedMsg));

              // Keep-alive ping every 15s to prevent connection drop
              const timer = setInterval(() => {
                try {
                  controller.enqueue(encoder.encode(": keepalive\n\n"));
                } catch (err) {
                  clearInterval(timer);
                }
              }, 15000);

              req.signal.addEventListener("abort", () => {
                clearInterval(timer);
                removeClient(conversationId, controller);
              });
            },
            cancel(controller) {
              removeClient(conversationId, controller);
            }
          });

          return new Response(body, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
            },
          });
        }
      }

      // Basic static files service + SPA
      const staticResponse = serveStatic(url);
      if (staticResponse) {
        // Simple cache control headers
        staticResponse.headers.set("Cache-Control", "no-cache");
        return staticResponse;
      }

      return jsonResponse({ error: "Not found" }, 404);

    } catch (err: any) {
      console.error(err);
      return jsonResponse({ error: "Internal Server Error", message: err.message }, 500);
    }
  },
});

console.log(`Server listening on http://localhost:${server.port}`);
