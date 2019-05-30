const encryptor = require('./encryptor.js');
const uuid = require('uuid');
const axios = require('axios');
const http = require('http');
const https = require('https');

class ObjectStorage {
    constructor(settings) {
        this.api = axios.create({
            baseURL: `${settings.OBJECT_STORAGE_URI}/`,
            httpAgent: new http.Agent({ keepAlive: true }),
            httpsAgent: new https.Agent({ keepAlive: true }),
            headers: { Authorization: `Bearer ${settings.OBJECT_STORAGE_TOKEN}` },
            validateStatus: null
        });
    }

    async requestRetry({ maxAttempts, delay, createReq, onRes }) {
        let attempts = 0;
        let res;
        let err;
        while (attempts < maxAttempts) {
            attempts++;
            try {
                res = await createReq();
            } catch (e) {
                err = e;
            }
            if (onRes && onRes(err, res)) {
                continue;
            }
            if (err || res.status >= 400) {
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            break;
        }
        if (err || res.status >= 400) {
            throw err || new Error(`HTTP error during object get: ${res.status} (${res.statusText})`);
        }
        return res;
    }

    async getObject(objectId) {
        const res = await this.requestRetry({
            maxAttempts: 3,
            delay: 100,
            createReq: () => this.api.get(`/objects/${objectId}`, { responseType: 'stream' })
        });

        return await encryptor.decryptMessageContentStream(res.data);
    }

    async addObject(data) {
        let objectId = uuid.v4();
        await this.requestRetry({
            maxAttempts: 3,
            delay: 100,
            createReq: () => this.api.put(
                `/objects/${objectId}`,
                encryptor.encryptMessageContentStream(data),
                { headers: { 'content-type': 'application/octet-stream' } }
            ),
            onRes: (err, res) => {
                if (!err && res.status === 409) {
                    objectId = uuid.v4();
                    return true;
                }
            }
        });

        return objectId;
    }
}

module.exports = ObjectStorage;