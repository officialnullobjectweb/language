/**
 * `plainly serve` (v0.4) — local HTTPS static server for the book & docs.
 *
 * Browsers restrict several features (clipboard, service workers, some
 * crypto APIs) on plain http:// origins, and some setups require https://
 * even locally. This server generates a self-signed certificate on first
 * run (no external tools needed — pure Node crypto), caches it in
 * .plainly/certs/, and serves a directory over HTTPS.
 *
 * The certificate is self-signed, so the browser will show a one-time
 * warning; clicking "Advanced → Proceed" is expected for local dev.
 */

import * as https from "node:https"
import * as http from "node:http"
import * as fs from "node:fs"
import * as path from "node:path"
import * as crypto from "node:crypto"
import * as readline from "node:readline"

const CERT_DIR = path.join(process.cwd(), ".plainly", "certs")
const CERT_FILE = path.join(CERT_DIR, "plainly-local.crt")
const KEY_FILE = path.join(CERT_DIR, "plainly-local.key")

/** Minimal ASN.1/PEM self-signed cert generation using Node's crypto. */
function generateSelfSignedCert(commonName: string): { key: string; cert: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })

  // Build a minimal X.509 v3 certificate by hand (ASN.1 DER).
  const version = Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02]) // [0] INTEGER 2
  const serial = asn1Integer(BigInt(Date.now()))
  // AlgorithmIdentifier ::= SEQUENCE { algorithm OID, parameters NULL }
  const signatureAlg = asn1Sequence(
    Buffer.concat([
      Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]), // sha256WithRSAEncryption
      Buffer.from([0x05, 0x00]), // NULL parameters — INSIDE the sequence
    ]),
  )
  const issuer = nameDer(commonName)
  const now = new Date()
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000)
  const notAfter = new Date(now.getTime() + 825 * 24 * 3600 * 1000)
  const validity = asn1Sequence(
    Buffer.concat([asn1Time(notBefore), asn1Time(notAfter)]),
  )
  const subject = nameDer(commonName)
  const spki = pemToDer(publicKey)

  const tbs = asn1Sequence(
    Buffer.concat([
      version,
      serial,
      signatureAlg,
      issuer,
      validity,
      subject,
      spki,
    ]),
  )

  const signer = crypto.createSign("sha256WithRSAEncryption")
  signer.update(tbs)
  const signature = signer.sign(privateKey)

  const cert = asn1Sequence(
    Buffer.concat([tbs, signatureAlg, asn1BitString(signature)]),
  )

  const certPem = wrapPem("CERTIFICATE", cert)
  return { key: privateKey, cert: certPem }
}

// ----- tiny DER helpers -----

/** Decode a PEM body (strip headers, base64-decode) into DER bytes. */
function pemToDer(pem: string): Buffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
  return Buffer.from(b64, "base64")
}

function asn1Length(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len])
  const bytes: number[] = []
  let n = len
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>= 8
  }
  return Buffer.concat([Buffer.from([0x80 | bytes.length]), Buffer.from(bytes)])
}

function asn1Sequence(content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x30]), asn1Length(content.length), content])
}

function asn1Set(content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x31]), asn1Length(content.length), content])
}

function asn1Integer(value: bigint): Buffer {
  let hex = value.toString(16)
  if (hex.length % 2) hex = "0" + hex
  const body = Buffer.from(hex, "hex")
  // Positive-integer padding when the high bit is set
  const padded = body[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), body]) : body
  return Buffer.concat([Buffer.from([0x02]), asn1Length(padded.length), padded])
}

function asn1Time(date: Date): Buffer {
  // UTCTime for dates before 2050, GeneralizedTime after.
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z"
  if (date.getUTCFullYear() < 2050) {
    const body = Buffer.from(iso.slice(2), "utf-8")
    return Buffer.concat([Buffer.from([0x17]), asn1Length(body.length), body])
  }
  const body = Buffer.from(iso, "utf-8")
  return Buffer.concat([Buffer.from([0x18]), asn1Length(body.length), body])
}

function asn1BitString(content: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from([0x00]), content])
  return Buffer.concat([Buffer.from([0x03]), asn1Length(body.length), body])
}

/** Name ::= SEQUENCE OF RelativeDistinguishedName; RDN ::= SET OF AttributeTypeAndValue. */
function nameDer(commonName: string): Buffer {
  // OID 2.5.4.3 (commonName)
  const oid = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03])
  const cn = Buffer.from(commonName, "utf-8")
  const cnValue = Buffer.concat([Buffer.from([0x0c]), asn1Length(cn.length), cn]) // UTF8String
  const atv = asn1Sequence(Buffer.concat([oid, cnValue]))
  const rdn = asn1Set(atv) // SET OF AttributeTypeAndValue
  return asn1Sequence(rdn) // Name = SEQUENCE OF RDN
}

function wrapPem(label: string, der: Buffer): string {
  const b64 = der.toString("base64")
  const lines = b64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`
}

function ensureCerts(): { key: string; cert: string } {
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    return { cert: fs.readFileSync(CERT_FILE, "utf-8"), key: fs.readFileSync(KEY_FILE, "utf-8") }
  }
  fs.mkdirSync(CERT_DIR, { recursive: true })
  const { key, cert } = generateSelfSignedCert("plainly-local")
  fs.writeFileSync(CERT_FILE, cert)
  fs.writeFileSync(KEY_FILE, key)
  return { cert, key }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
}

function serveRequest(root: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = (req.url ?? "/").split("?")[0]
  let filePath = path.normalize(path.join(root, decodeURIComponent(url)))
  if (!filePath.startsWith(root)) {
    res.writeHead(403)
    res.end("Forbidden")
    return
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html")
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    // SPA-friendly fallback: serve index.html for unknown routes
    const fallback = path.join(root, "index.html")
    if (fs.existsSync(fallback)) {
      filePath = fallback
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Not found")
      return
    }
  }
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  })
  fs.createReadStream(filePath).pipe(res)
}

export interface ServeOptions {
  /** Directory to serve. */
  root: string
  /** Port number. */
  port?: number
  /** Serve plain http instead of https. */
  insecure?: boolean
}

export function serve(options: ServeOptions): void {
  const root = path.resolve(options.root)
  const port = options.port ?? 3443
  if (!fs.existsSync(root)) {
    console.error(`The folder '${root}' doesn't exist.`)
    process.exit(1)
  }

  if (options.insecure) {
    const server = http.createServer((req, res) => serveRequest(root, req, res))
    server.listen(port, () => {
      console.log(`Serving ${root}`)
      console.log(`  → http://localhost:${port}`)
    })
    return
  }

  const { key, cert } = ensureCerts()
  const server = https.createServer({ key, cert }, (req, res) => serveRequest(root, req, res))
  server.listen(port, () => {
    console.log(`Serving ${root} over HTTPS (self-signed certificate in .plainly/certs/)`)
    console.log(`  → https://localhost:${port}`)
    console.log(`\nYour browser will warn about the certificate the first time —`)
    console.log(`click "Advanced" → "Proceed to localhost" to continue. This is`)
    console.log(`normal for a locally-generated certificate.`)
    console.log(`\nPress Ctrl+C to stop.`)
  })
}

/** Interactive prompt helper (kept for future `plainly dev` command). */
export function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`${question} (y/n) `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase().startsWith("y"))
    })
  })
}
