const http = require('http');

const CONCURRENT_REQUESTS = 100;
const URL = 'http://localhost:3000/api/events?doc_id=benchmark-room-1';

console.log(`Starting thundering herd simulation with ${CONCURRENT_REQUESTS} requests...`);

const start = Date.now();
let completed = 0;

function sendRequest() {
    http.get(URL, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
            completed++;
            if (completed === CONCURRENT_REQUESTS) {
                const end = Date.now();
                console.log(`All ${CONCURRENT_REQUESTS} requests completed in ${end - start}ms`);
                console.log('Peak connection count check (run ss -s in another terminal during execution)');
            }
        });
    }).on('error', (e) => {
        console.error(`Request failed: ${e.message}`);
        completed++;
    });
}

// Synchronize to the next second
const wait = 1000 - (Date.now() % 1000);
setTimeout(() => {
    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
        sendRequest();
    }
}, wait);
