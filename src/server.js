const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');
const Redis = require('ioredis');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3000;
const instanceId = randomUUID();

// Redis Client Setup
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let redisPub;
let redisSub;
let redisAvailable = false;

try {
    redisPub = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
            if (times > 3) {
                console.warn('Redis connection failed, falling back to in-memory mode.');
                redisAvailable = false;
                return null;
            }
            return Math.min(times * 100, 2000);
        }
    });

    redisSub = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
            if (times > 3) return null;
            return Math.min(times * 100, 2000);
        }
    });

    redisPub.on('connect', () => {
        console.log(`Connected to Redis for Publishing (Instance: ${instanceId})`);
        redisAvailable = true;
    });

    redisPub.on('error', (err) => {
        console.warn('Redis Pub Error:', err.message);
    });

    redisSub.on('connect', () => {
        console.log(`Connected to Redis for Subscribing (Instance: ${instanceId})`);
    });

    redisSub.on('error', (err) => {
        console.warn('Redis Sub Error:', err.message);
    });
} catch (err) {
    console.warn('Redis connection could not be initialized:', err);
}

// Room Manager State (Local copy of rooms active on this specific instance)
const rooms = new Map(); // doc_id -> { wsClients: Set, lpClients: Map, positions: Map }
const eventLog = new Map(); // doc_id -> [{ event, timestamp }]

function getRoom(docId) {
    if (!rooms.has(docId)) {
        rooms.set(docId, {
            wsClients: new Set(),
            lpClients: new Map(), // user_id -> res object
            positions: new Map() // user_id -> position data
        });
        eventLog.set(docId, []);
    }
    return rooms.get(docId);
}

// Redis Pub/Sub Subscriptions and Handlers
const subscribedRooms = new Set();
const idleTimeouts = new Map();

function ensureSubscribed(docId) {
    if (!redisAvailable) return;
    if (subscribedRooms.has(docId)) return;
    subscribedRooms.add(docId);

    redisSub.subscribe(`room:${docId}`).catch(err => {
        console.error(`Failed to subscribe to room:${docId}`, err);
        subscribedRooms.delete(docId);
    });
}

function onClientConnected(docId) {
    ensureSubscribed(docId);
    if (idleTimeouts.has(docId)) {
        clearTimeout(idleTimeouts.get(docId));
        idleTimeouts.delete(docId);
    }
}

function checkAndUnsubscribe(docId) {
    if (!redisAvailable) return;
    const room = rooms.get(docId);
    if (!room) return;

    if (room.wsClients.size === 0 && room.lpClients.size === 0) {
        if (idleTimeouts.has(docId)) return; // Already scheduled

        const timeoutId = setTimeout(() => {
            idleTimeouts.delete(docId);
            const currentRoom = rooms.get(docId);
            if (currentRoom && currentRoom.wsClients.size === 0 && currentRoom.lpClients.size === 0) {
                redisSub.unsubscribe(`room:${docId}`).then(() => {
                    subscribedRooms.delete(docId);
                    rooms.delete(docId);
                    eventLog.delete(docId);
                    return redisPub.hdel(`room:${docId}:presence`, instanceId);
                }).catch(err => {
                    console.error(`Failed to unsubscribe from room:${docId}`, err);
                });
            }
        }, 10000); // 10 seconds idle timeout before cleaning up subscription

        idleTimeouts.set(docId, timeoutId);
    }
}

async function updatePresence(docId) {
    const room = getRoom(docId);
    const wsCount = room.wsClients.size;
    try {
        if (wsCount > 0) {
            await redisPub.hset(`room:${docId}:presence`, instanceId, wsCount);
            await redisPub.expire(`room:${docId}:presence`, 3600);
        } else {
            await redisPub.hdel(`room:${docId}:presence`, instanceId);
        }

        // Calculate total presence count across all nodes
        const presenceMap = await redisPub.hgetall(`room:${docId}:presence`);
        let totalCount = 0;
        for (const key in presenceMap) {
            totalCount += parseInt(presenceMap[key]) || 0;
        }

        // Publish to channel
        await redisPub.publish(`room:${docId}`, JSON.stringify({
            type: 'presence',
            count: totalCount
        }));
    } catch (err) {
        console.error(`Error updating presence for ${docId}:`, err);
    }
}

// Receive messages from Redis Pub/Sub
if (redisSub) {
    redisSub.on('message', (channel, messageStr) => {
        const docId = channel.replace(/^room:/, '');
        try {
            const payload = JSON.parse(messageStr);
            handleRedisMessage(docId, payload);
        } catch (e) {
            console.error('Error parsing Redis message:', e);
        }
    });
}

function handleRedisMessage(docId, payload) {
    const room = getRoom(docId);
    if (!room) return;

    if (payload.type === 'cursor') {
        const message = payload.message;

        // Update active user position
        if (message.user_id) {
            room.positions.set(message.user_id, { x: message.x, y: message.y });
        }

        // Append to local eventLog for in-flight/since queries
        let log = eventLog.get(docId);
        if (!log) {
            log = [];
            eventLog.set(docId, log);
        }
        log.push({ event: message, timestamp: Date.now() });
        if (log.length > 100) log.shift();

        // Broadcast to local WebSocket clients (excluding the original sender)
        const wsMessage = JSON.stringify(message);
        room.wsClients.forEach(client => {
            if (client.id !== payload.senderSocketId && client.readyState === 1) {
                client.send(wsMessage);
            }
        });

        // Broadcast to local Long Polling clients
        const lpClients = Array.from(room.lpClients.values());
        room.lpClients.clear(); // Clear all pending LP requests for this room locally
        lpClients.forEach(res => {
            res.json([message]);
        });

        // Trigger unsubscribe check since lpClients count went to 0
        checkAndUnsubscribe(docId);

    } else if (payload.type === 'presence') {
        // Broadcast presence count to local WebSocket clients
        const wsMessage = JSON.stringify({ type: 'presence', count: payload.count });
        room.wsClients.forEach(client => {
            if (client.readyState === 1) {
                client.send(wsMessage);
            }
        });
    }
}

// Fallback in-memory broadcast
function localBroadcast(docId, message, excludeWs = null) {
    const room = getRoom(docId);

    // Update active user position
    if (message.type === 'cursor' && message.user_id) {
        room.positions.set(message.user_id, { x: message.x, y: message.y });
    }

    // Broadcast to WebSockets
    const wsMessage = JSON.stringify(message);
    room.wsClients.forEach(client => {
        if (client !== excludeWs && client.readyState === 1) {
            client.send(wsMessage);
        }
    });

    // Broadcast to Long Polling clients
    const lpClients = Array.from(room.lpClients.values());
    room.lpClients.clear();
    lpClients.forEach(res => {
        res.json([message]);
    });

    // Log event locally
    let log = eventLog.get(docId);
    if (!log) {
        log = [];
        eventLog.set(docId, log);
    }
    log.push({ event: message, timestamp: Date.now() });
    if (log.length > 100) log.shift();
}

// HTTP Long Polling - Post Event
app.post('/api/event', async (req, res) => {
    const { doc_id, x, y, sent_at, user_id } = req.body;
    if (!doc_id) return res.status(400).json({ error: 'Missing doc_id' });

    const event = {
        type: 'cursor',
        x,
        y,
        user_id: user_id || 'anonymous',
        sent_at: sent_at || (BigInt(Date.now()) * 1000000n).toString()
    };

    if (redisAvailable) {
        try {
            const eventData = { event, timestamp: Date.now() };
            // Log in Redis list for history sync
            await redisPub.rpush(`room:${doc_id}:events`, JSON.stringify(eventData));
            await redisPub.ltrim(`room:${doc_id}:events`, -100, -1);
            await redisPub.expire(`room:${doc_id}:events`, 3600);

            // Publish message
            await redisPub.publish(`room:${doc_id}`, JSON.stringify({
                type: 'cursor',
                message: event,
                senderSocketId: null
            }));
            res.status(202).end();
        } catch (err) {
            console.error('Error posting event to Redis:', err);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    } else {
        localBroadcast(doc_id, event);
        res.status(202).end();
    }
});

// HTTP Long Polling - Get Events
app.get('/api/events', async (req, res) => {
    const { doc_id, since } = req.query;
    if (!doc_id) return res.status(400).json({ error: 'Missing doc_id' });

    onClientConnected(doc_id);
    const room = getRoom(doc_id);
    const userId = randomUUID();

    // Check if there are events since the timestamp
    if (since) {
        const sinceTs = parseInt(since);
        if (redisAvailable) {
            try {
                const eventsRaw = await redisPub.lrange(`room:${doc_id}:events`, 0, -1);
                const events = eventsRaw.map(e => JSON.parse(e));
                const newEvents = events.filter(e => e.timestamp > sinceTs).map(e => e.event);
                if (newEvents.length > 0) {
                    return res.json(newEvents);
                }
            } catch (err) {
                console.error('Error fetching events from Redis:', err);
            }
        } else {
            const log = eventLog.get(doc_id) || [];
            const newEvents = log.filter(e => e.timestamp > sinceTs).map(e => e.event);
            if (newEvents.length > 0) {
                return res.json(newEvents);
            }
        }
    }

    // Otherwise, hold the request
    room.lpClients.set(userId, res);

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
        if (room.lpClients.has(userId)) {
            room.lpClients.delete(userId);
            res.json([]); // Return empty array on timeout
            checkAndUnsubscribe(doc_id);
        }
    }, 30000);

    // Cleanup on client close
    req.on('close', () => {
        clearTimeout(timeout);
        if (room.lpClients.has(userId)) {
            room.lpClients.delete(userId);
            checkAndUnsubscribe(doc_id);
        }
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
    ws.id = randomUUID();
    onClientConnected(docId);

    const room = getRoom(docId);
    room.wsClients.add(ws);
    ws.isAlive = true;

    // Presence broadcast
    if (redisAvailable) {
        updatePresence(docId);
    } else {
        localBroadcast(docId, { type: 'presence', count: room.wsClients.size });
    }

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            if (message.type === 'cursor' && !message.sent_at) {
                message.sent_at = (BigInt(Date.now()) * 1000000n).toString();
            }

            if (redisAvailable) {
                const eventData = { event: message, timestamp: Date.now() };
                await redisPub.rpush(`room:${docId}:events`, JSON.stringify(eventData));
                await redisPub.ltrim(`room:${docId}:events`, -100, -1);
                await redisPub.expire(`room:${docId}:events`, 3600);

                await redisPub.publish(`room:${docId}`, JSON.stringify({
                    type: 'cursor',
                    message,
                    senderSocketId: ws.id
                }));
            } else {
                localBroadcast(docId, message, ws);
            }
        } catch (e) {
            console.error('Invalid WS message', e);
        }
    });

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    const handleDisconnect = () => {
        const currentRoom = rooms.get(docId);
        if (currentRoom) {
            currentRoom.wsClients.delete(ws);
            if (redisAvailable) {
                updatePresence(docId);
            } else {
                localBroadcast(docId, { type: 'presence', count: currentRoom.wsClients.size });
            }
            checkAndUnsubscribe(docId);
        }
    };

    ws.on('close', handleDisconnect);
    ws.on('error', handleDisconnect);
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

// Graceful shutdown logic
async function cleanupPresence() {
    if (!redisAvailable) return;
    try {
        const roomsList = Array.from(rooms.keys());
        for (const docId of roomsList) {
            await redisPub.hdel(`room:${docId}:presence`, instanceId);
            const presenceMap = await redisPub.hgetall(`room:${docId}:presence`);
            let totalCount = 0;
            for (const key in presenceMap) {
                totalCount += parseInt(presenceMap[key]) || 0;
            }
            await redisPub.publish(`room:${docId}`, JSON.stringify({
                type: 'presence',
                count: totalCount
            }));
        }
        console.log('Cleaned up presence keys from Redis.');
    } catch (err) {
        console.error('Error during presence cleanup:', err);
    }
}

function gracefulShutdown(signal) {
    console.log(`Received ${signal}. Starting graceful shutdown...`);
    clearInterval(interval);

    wss.close(() => {
        console.log('WebSocket server closed.');
    });

    cleanupPresence().finally(() => {
        server.close(() => {
            console.log('HTTP server closed.');
            if (redisPub) redisPub.disconnect();
            if (redisSub) redisSub.disconnect();
            process.exit(0);
        });
    });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

