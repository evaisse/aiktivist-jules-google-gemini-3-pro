import { AppEvent, logEvent } from "./logger";

// In-memory store of active Server-Sent Event clients mapped by conversation ID
const clients = new Map<string, Set<ReadableStreamDefaultController>>();

export function addClient(conversationId: string, controller: ReadableStreamDefaultController) {
  if (!clients.has(conversationId)) {
    clients.set(conversationId, new Set());
  }
  clients.get(conversationId)!.add(controller);

  // Clean up on disconnect
  return () => {
    removeClient(conversationId, controller);
  };
}

export function removeClient(conversationId: string, controller: ReadableStreamDefaultController) {
  const convClients = clients.get(conversationId);
  if (convClients) {
    convClients.delete(controller);
    if (convClients.size === 0) {
      clients.delete(conversationId);
    }
  }
}

export async function broadcastEvent(conversationId: string, event: AppEvent) {
  // 1. Log to DB and file
  await logEvent({ ...event, conversationId });

  // 2. Broadcast to connected SSE clients
  const convClients = clients.get(conversationId);
  if (convClients && convClients.size > 0) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    const encoder = new TextEncoder();

    for (const controller of convClients) {
      try {
        controller.enqueue(encoder.encode(data));
      } catch (err) {
        removeClient(conversationId, controller);
      }
    }
  }
}
