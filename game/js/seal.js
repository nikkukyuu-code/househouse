/** Score sealing (AES-GCM + HMAC-SHA256). Secret is XOR-packed, not plaintext. */
const _m = [105, 130, 47, 80, 62, 229, 250, 3, 13, 11, 205, 205, 228, 187, 152, 154, 56, 179, 238, 102, 127, 248, 54, 41, 248, 76, 26, 14, 134, 19, 85, 137, 121, 54, 145, 167, 189, 117, 141, 238, 90, 24, 251, 239, 96, 255, 64, 160];
const _e = [92, 228, 29, 54, 93, 135, 202, 98, 52, 110, 244, 174, 213, 131, 253, 174, 10, 128, 143, 3, 79, 204, 3, 74, 157, 47, 123, 62, 177, 119, 51, 187, 65, 3, 160, 195, 220, 23, 239, 221, 104, 122, 200, 141, 83, 158, 34, 195];
const _k = () => _e.map((x, i) => String.fromCharCode(x ^ _m[i])).join('');
const _b = (buf) => {
  let s = '';
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
export async function sealScore(token, payload) {
  const enc = new TextEncoder();
  const secret = _k();
  const a = await crypto.subtle.digest('SHA-256', enc.encode('enc|' + secret + '|' + token));
  const m = await crypto.subtle.digest('SHA-256', enc.encode('mac|' + secret + '|' + token));
  const aes = await crypto.subtle.importKey('raw', a, 'AES-GCM', false, ['encrypt']);
  const mac = await crypto.subtle.importKey('raw', m, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const nonce = [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(JSON.stringify(Object.assign({}, payload, { t: token, n: nonce }))));
  const ivB = _b(iv), ctB = _b(ct);
  const sig = await crypto.subtle.sign('HMAC', mac, enc.encode(ivB + '.' + ctB));
  return { iv: ivB, ct: ctB, mac: _b(sig) };
}
