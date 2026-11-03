// SHA-256 as lowercase hex. Device work (crypto.subtle): run it before opening any transaction.

/** @param {ArrayBuffer|ArrayBufferView} data @returns {Promise<string>} */
export async function sha256Hex(data) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}
