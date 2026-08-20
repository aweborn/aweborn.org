// y-websocket doesn't ship types for bin/utils
declare module "y-websocket/bin/utils" {
  import type { IncomingMessage } from "node:http";
  import type { WebSocket } from "ws";

  /**
   * Set up a y-websocket connection on an existing WebSocket.
   * The `docName` is parsed from the URL pathname if not provided.
   */
  export function setupWSConnection(
    conn: WebSocket,
    req: IncomingMessage,
    options?: {
      docName?: string;
      gc?: boolean;
    }
  ): void;
}
