#!/usr/bin/env node
// Usage: node sealcli.mjs TOKEN '{"s":1234,"w":1}'
// Reads the deploy-time secret from /workspace/cf-tools/house-seal-secret.txt (not in the repo).
import { readFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const secret = readFileSync('/workspace/cf-tools/house-seal-secret.txt', 'utf8').trim();
const token = process.argv[2];
const payload = JSON.parse(process.argv[3] || '{}');

const b = (buf) => Buffer.from(buf).toString('base64');
const enc = new TextEncoder();
const a = await crypto.subtle.digest('SHA-256', enc.encode('enc|' + secret + '|' + token));
const m = await crypto.subtle.digest('SHA-256', enc.encode('mac|' + secret + '|' + token));
const aes = await crypto.subtle.importKey('raw', a, 'AES-GCM', false, ['encrypt']);
const mac = await crypto.subtle.importKey('raw', m, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const nonce = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, '0')).join('');
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(JSON.stringify(Object.assign({}, payload, { t: token, n: nonce }))));
const ivB = b(iv), ctB = b(ct);
const sig = await crypto.subtle.sign('HMAC', mac, enc.encode(ivB + '.' + ctB));
process.stdout.write(JSON.stringify({ iv: ivB, ct: ctB, mac: b(sig) }));
