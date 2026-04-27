const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3000;

// Room Manager State
const rooms = new Map(); // doc_id -> { wsClients: Set, lpClients: Map }
const eventLog = new Map(); // doc_id -> [{ event, timestamp }]

function getRoom(docId) {
    if (!rooms.has(docId)) {
        rooms.set(docId, {
            wsClients: new Set(),
            lpClients: new Map() // user_id -> res object
        });
        eventLog.set(docId, []);
    }
    return rooms.get(docId);
}

function broadcast(docId, message, excludeWs = null) {
    const room = getRoom(docId);
    
    // Broadcast to WebSockets
    const wsMessage = JSON.stringify(message);
    room.wsClients.forEach(client => {
        if (client !== excludeWs && client.readyState === 1) {
            client.send(wsMessage);
        }
    });

    // Broadcast to Long Polling clients
    const lpClients = Array.from(room.lpClients.values());
    room.lpClients.clear(); // Clear all pending LP requests for this room
    lpClients.forEach(res => {
        res.json([message]);
    });

    // Log event (keep last 100 for 'since' queries)
    const log = eventLog.get(docId);
    log.push({ event: message, timestamp: Date.now() });
    if (log.length > 100) log.shift();
}

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
