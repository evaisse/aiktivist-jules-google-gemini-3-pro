import { broadcastEvent } from "./events";
import { db } from "./db";
import { generateId } from "./auth";

const OPENROUTER_ENDPOINT = process.env.OPENROUTER_ENDPOINT || "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

export async function processConversationAI(conversationId: string) {
  try {
    // 1. Fetch conversation history
    const messages = db.query(`
      SELECT role, content
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversationId) as { role: string, content: string }[];

    if (messages.length === 0) return;

    // Format for OpenRouter
    const apiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 2. Start thinking event
    await broadcastEvent(conversationId, { type: "thinking", payload: { message: "AI is thinking..." } });

    // 3. Call OpenRouter with stream=true
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aiktivist.local",
        "X-Title": "Aiktivist",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: apiMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API Error: ${response.status} ${errorText}`);
    }

    if (!response.body) throw new Error("No body in response");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantMessageContent = "";

    const aiMessageId = generateId();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === "") continue;
        if (line === "data: [DONE]") {
           break;
        }

        if (line.startsWith("data: ")) {
          const dataStr = line.replace("data: ", "");
          try {
            const data = JSON.parse(dataStr);
            const textChunk = data.choices[0]?.delta?.content || "";
            if (textChunk) {
              assistantMessageContent += textChunk;
              // Broadcast stream chunk to frontend
              await broadcastEvent(conversationId, {
                type: "assistant_chunk",
                payload: { chunk: textChunk, id: aiMessageId },
              });
            }
          } catch (e) {
             console.error("Error parsing streaming chunk", e);
          }
        }
      }
    }

    // 4. Save the finalized AI message to DB
    db.run(
      "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)",
      [aiMessageId, conversationId, "assistant", assistantMessageContent]
    );

    // 5. Broadcast complete event
    await broadcastEvent(conversationId, {
      type: "assistant_done",
      payload: { id: aiMessageId, fullContent: assistantMessageContent }
    });

  } catch (err: any) {
    console.error("AI stream processing error:", err);
    await broadcastEvent(conversationId, {
      type: "error",
      payload: { message: err.message || "Unknown AI stream error" },
    });
  }
}
