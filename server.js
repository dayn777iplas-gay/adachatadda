const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: process.env.PORT || 3000 });

wss.on("connection", ws => {
  ws.on("message", msg => {
    // пересылаем всем клиентам
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg.toString());
      }
    });
  });

  ws.send("[Система] Добро пожаловать в общий чат!");
});
