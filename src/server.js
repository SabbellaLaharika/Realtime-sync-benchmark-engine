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

// HTTP Long Polling - Post Event
app.post('/api/event', (req, res) => {
    const { doc_id, x, y, sent_at, user_id } = req.body;
    if (!doc_id) return res.status(400).json({ error: 'Missing doc_id' });

    const event = {
        type: 'cursor',
        x,
        y,
        user_id: user_id || 'anonymous',
        sent_at: sent_at || String(process.hrtime.bigint())
    };

    broadcast(doc_id, event);
    res.status(202).end();
});

// HTTP Long Polling - Get Events (Long Polling)
app.get('/api/events', (req, res) => {
    const { doc_id, since } = req.query;
    if (!doc_id) return res.status(400).json({ error: 'Missing doc_id' });

    const room = getRoom(doc_id);
    const userId = uuidv4();

    // Check if there are events since the timestamp
    if (since) {
        const sinceTs = parseInt(since);
        const log = eventLog.get(doc_id) || [];
        const newEvents = log.filter(e => e.timestamp > sinceTs).map(e => e.event);
        if (newEvents.length > 0) {
            return res.json(newEvents);
        }
    }

    // Otherwise, hold the request
    room.lpClients.set(userId, res);

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
        if (room.lpClients.has(userId)) {
            room.lpClients.delete(userId);
            res.json([]); // Return empty array on timeout
        }
    }, 30000);

    // Cleanup on client close
    req.on('close', () => {
        clearTimeout(timeout);
        room.lpClients.delete(userId);
    });
});

// Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/ws') {
        const doc_id = url.searchParams.get('doc_id');
        if (!doc_id) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request, doc_id);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', (ws, request, docId) => {
    const room = getRoom(docId);
    room.wsClients.add(ws);
    ws.isAlive = true;

    // Presence broadcast
    broadcast(docId, { type: 'presence', count: room.wsClients.size });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            // Ensure message has current timestamp if missing for benchmarking
            if (message.type === 'cursor' && !message.sent_at) {
                message.sent_at = String(process.hrtime.bigint());
            }
            broadcast(docId, message, ws);
        } catch (e) {
            console.error('Invalid WS message', e);
        }
    });

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('close', () => {
        room.wsClients.delete(ws);
        broadcast(docId, { type: 'presence', count: room.wsClients.size });
    });

    ws.on('error', () => {
        room.wsClients.delete(ws);
        broadcast(docId, { type: 'presence', count: room.wsClients.size });
    });
});

// Heartbeat interval
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
