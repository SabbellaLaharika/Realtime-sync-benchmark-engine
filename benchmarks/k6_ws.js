import ws from 'k6/ws';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

export const options = {
    vus: 200,
    duration: '2m',
};

const wsLatency = new Trend('ws_latency');

export default function () {
    const docId = 'benchmark-room-1';
    const url = `ws://app:3000/ws?doc_id=${docId}`;
    const params = { tags: { my_tag: 'hello' } };

    const res = ws.connect(url, params, function (socket) {
        socket.on('open', () => {
            socket.setInterval(() => {
                const payload = JSON.stringify({
                    type: 'cursor',
                    x: Math.random() * 1000,
                    y: Math.random() * 1000,
                    user_id: `user-${__VU}`,
                    sent_at: Date.now().toString() + '000000' // Simple nano representation
                });
                socket.send(payload);
            }, 100); // Send every 100ms
        });

        socket.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.type === 'cursor' && msg.sent_at) {
                const sentAt = BigInt(msg.sent_at);
                const now = BigInt(Date.now().toString() + '000000');
                const latency = Number(now - sentAt) / 1000000; // ms
                wsLatency.add(latency);
            }
        });

        socket.on('close', () => console.log('disconnected'));
        socket.on('error', (e) => console.log('error: ', e.error()));

        socket.setTimeout(() => {
            socket.close();
        }, 115000); // Close slightly before 2m
    });

    check(res, { 'status is 101': (r) => r && r.status === 101 });
}
