const WA_API_BASE = 'https://wa-swagger.pavtech.com.br';

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const path = req.query.path || '';

    if (!path) {
        res.status(400).json({ error: 'Query parameter "path" is required' });
        return;
    }

    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        res.status(401).json({ error: 'X-API-Key header is required' });
        return;
    }

    const url = WA_API_BASE + path;
    const method = req.method;

    const headers = {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
    };

    try {
        const fetchOptions = { method, headers };

        if (method !== 'GET' && method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
            fetchOptions.body = JSON.stringify(req.body);
        }

        const response = await fetch(url, fetchOptions);
        const contentType = response.headers.get('content-type') || '';

        if (response.status === 204) {
            res.status(204).end();
            return;
        }

        if (contentType.includes('application/json')) {
            const data = await response.json();
            res.status(response.status).json(data);
        } else {
            const text = await response.text();
            res.status(response.status).send(text);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
