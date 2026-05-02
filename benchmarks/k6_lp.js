import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

export const options = {
    vus: 200,
    duration: '2m',
};

const lpLatency = new Trend('lp_latency');

export default function () {
    const docId = 'benchmark-room-1';
    const userId = `user-${__VU}`;

    // One VU will both post and poll? No, let's separate or make them random.
    // To simulate real usage, we poll and occasionally post.

    // POST cursor update
    const postPayload = JSON.stringify({
        doc_id: docId,
        x: Math.random() * 1000,
        y: Math.random() * 1000,
        user_id: userId,
        sent_at: Date.now().toString() + '000000'
    });

    http.post('http://app:3000/api/event', postPayload, {
        headers: { 'Content-Type': 'application/json' },
    });

    // LONG POLL
    const res = http.get(`http://app:3000/api/events?doc_id=${docId}`);
    
    check(res, {
        'status is 200': (r) => r.status === 200,
    });

    if (res.status === 200) {
        const events = JSON.parse(res.body);
        events.forEach(msg => {
            if (msg.type === 'cursor' && msg.sent_at) {
                const sentAt = BigInt(msg.sent_at);
                const now = BigInt(Date.now().toString() + '000000');
                const latency = Number(now - sentAt) / 1000000; // ms
                lpLatency.add(latency);
            }
        });
    }

    sleep(0.1); // Small sleep to prevent tight loop if server returns instantly
}
