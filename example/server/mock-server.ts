/**
 * 用于测试 due-client-laya 的 mock due WebSocket 服务器。
 *
 * 协议与客户端 Packer 保持一致（大端序，route/seq 各 2 字节）：
 *   - 普通消息: [4字节size][1字节header=0][route(2)][seq(2)][buffer...]
 *   - 心跳:     [4字节size=1][1字节header=0x80]
 *   - 握手:     [4字节size][1字节header=0x01][payload...]
 *
 * 支持 due 会话安全握手：
 *   ClientHello -> ServerHello（ECDSA P-256 签名）-> Finished
 *
 * 首次启动会在当前目录生成一对 ECDSA 测试密钥（key.pem / key.pub.pem），
 * 并打印公钥，供客户端 Demo 的 SERVER_PUBLIC_KEY 使用。
 *
 * 使用:
 *   cd example/server && npm install && npm start
 */
import { createPrivateKey, generateKeyPairSync, randomBytes as nodeRandomBytes, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { Packer } from "../../src/packer";
import { bytesToBigInt, concatBytes, equalBytes, randomBytes, utf8Bytes } from "../../src/security/bytes";
import { DEFAULT_SUITES, isSuiteSupported } from "../../src/security/aead";
import {
    decodeHandshakeFrame,
    deriveKeyMaterial,
    Direction,
    encodeHandshakeFrame,
    HandshakeFrame,
    KeyMaterial,
    SecureSession,
} from "../../src/security/handshake";
import { hmacSha256, sha256 } from "../../src/security/sha256";
import { generateX25519KeyPair, x25519 } from "../../src/security/x25519";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const TRANSCRIPT_LABEL = utf8Bytes("due-handshake-v1");

// 服务端随机字节源（session 安全握手需要 CSPRNG）
const random = (length: number): Uint8Array => new Uint8Array(nodeRandomBytes(length));

// node:crypto 的 Buffer 转换为 ArrayBuffer
function toArrayBuffer(data: Buffer): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/**
 * 加载或生成 ECDSA P-256 测试密钥
 */
function loadSigner(): { signer: (data: Uint8Array) => Uint8Array; publicKeyPem: string } {
    const keyDir = dirname(fileURLToPath(import.meta.url));
    const privateKeyPath = join(keyDir, "key.pem");
    const publicKeyPath = join(keyDir, "key.pub.pem");

    let privateKeyPem: string;
    let publicKeyPem: string;

    if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
        privateKeyPem = readFileSync(privateKeyPath, "utf8");
        publicKeyPem = readFileSync(publicKeyPath, "utf8");
    } else {
        const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

        privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
        publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

        writeFileSync(privateKeyPath, privateKeyPem);
        writeFileSync(publicKeyPath, publicKeyPem);

        console.log(`[mock-server] 已生成测试密钥: ${publicKeyPath}`);
    }

    const privateKey = createPrivateKey(privateKeyPem);

    // due 的 ECDSA 签名格式为 r<分隔符>s 的十进制文本
    const signer = (data: Uint8Array): Uint8Array => {
        const raw = sign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" });
        const half = raw.length / 2;
        const r = bytesToBigInt(new Uint8Array(raw.subarray(0, half)));
        const s = bytesToBigInt(new Uint8Array(raw.subarray(half)));

        return encoder.encode(`${r.toString()} ${s.toString()}`);
    };

    return { signer, publicKeyPem };
}

/**
 * 构造服务器心跳包（携带服务器时间戳）
 * 格式：[size=9][header=0x80][uint64 timestamp]
 */
function packHeartbeat(millisecond: number): Buffer {
    const buf = Buffer.alloc(13);
    buf.writeUInt32BE(9, 0);
    buf.writeUInt8(1 << 7, 4);
    buf.writeBigUInt64BE(BigInt(millisecond), 5);

    return buf;
}

interface PendingHandshake {
    transcript: Uint8Array;
    finishKey: Uint8Array;
    session: SecureSession;
}

/**
 * 处理 ClientHello 并返回 ServerHello 与待确认的握手状态
 */
function acceptHandshake(frame: Uint8Array, signer: (data: Uint8Array) => Uint8Array): { reply: Uint8Array; pending: PendingHandshake } {
    const { type, body } = decodeHandshakeFrame(frame);

    if (type !== HandshakeFrame.ClientHello || body.length < 65) {
        throw new Error("expect client hello");
    }

    const clientRandom = body.subarray(0, 32);
    const clientPublicKey = body.subarray(32, 64);
    const count = body[64];

    if (count === 0 || body.length !== 65 + count) {
        throw new Error("invalid client hello");
    }

    const offered = Array.from(body.subarray(65));
    const suiteID = DEFAULT_SUITES.find((suite) => offered.indexOf(suite) !== -1 && isSuiteSupported(suite));

    if (suiteID === undefined) {
        throw new Error("no common aead suite");
    }

    const { privateKey, publicKey } = generateX25519KeyPair(random);
    const serverRandom = randomBytes(32, random);
    const prefix = concatBytes(new Uint8Array([suiteID]), serverRandom, publicKey);
    const signature = signer(sha256(concatBytes(TRANSCRIPT_LABEL, body, prefix)));
    const transcript = sha256(concatBytes(body, prefix, signature));
    const shared = x25519(privateKey, clientPublicKey);
    const salt = concatBytes(clientRandom, serverRandom);
    const material: KeyMaterial = deriveKeyMaterial(shared, salt, transcript);
    const mac = hmacSha256(material.s2cFinish, transcript);
    const replyBody = concatBytes(
        prefix,
        new Uint8Array([(signature.length >>> 8) & 0xff, signature.length & 0xff]),
        signature,
        mac,
    );

    return {
        reply: encodeHandshakeFrame(HandshakeFrame.ServerHello, replyBody),
        pending: {
            transcript,
            finishKey: material.c2sFinish,
            session: new SecureSession(suiteID, material, "server"),
        },
    };
}

/**
 * 校验客户端 Finished 帧
 */
function confirmHandshake(pending: PendingHandshake, frame: Uint8Array): SecureSession {
    const { type, body } = decodeHandshakeFrame(frame);

    if (type !== HandshakeFrame.Finished) {
        throw new Error("expect finished");
    }

    if (!equalBytes(hmacSha256(pending.finishKey, pending.transcript), body)) {
        throw new Error("invalid finished mac");
    }

    return pending.session;
}

const PORT = Number(process.env.PORT || 3553);

// 与 example/src/Demo.ts 中的 Packer 配置保持一致
const packer = new Packer({
    byteOrder: "big",
    seqBytes: 2,
    routeBytes: 2,
    bufferBytes: 5000,
});

const { signer, publicKeyPem } = loadSigner();
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws: WebSocket) => {
    let session: SecureSession | undefined;
    let pending: PendingHandshake | undefined;

    console.log("[mock-server] 客户端已连接");

    ws.on("message", (data) => {
        const raw = data as Buffer;
        const packet = packer.unpack(toArrayBuffer(raw));

        // 握手帧 -> 推进握手状态机
        if (packet.isHandshake) {
            try {
                const payload = packet.handshake || new Uint8Array(0);

                if (session) {
                    return;
                }

                if (pending === undefined) {
                    const accepted = acceptHandshake(payload, signer);
                    pending = accepted.pending;
                    ws.send(Buffer.from(packer.packHandshake(accepted.reply)));
                } else {
                    session = confirmHandshake(pending, payload);
                    pending = undefined;
                    console.log("[mock-server] 安全握手完成");
                }
            } catch (error) {
                console.error("[mock-server] 安全握手失败:", error);
                ws.close();
            }

            return;
        }

        // 心跳包 -> 回复携带服务器时间戳的心跳
        if (packet.isHeartbeat) {
            ws.send(packHeartbeat(Date.now()));
            return;
        }

        if (!packet.message) {
            return;
        }

        let message = packet.message;

        // 安全会话已建立 -> 解密客户端消息
        if (session) {
            try {
                message = {
                    seq: message.seq,
                    route: message.route,
                    buffer: session.open(
                        message.buffer || new Uint8Array(0),
                        Direction.ClientToServer,
                        message.route,
                        message.seq || 0,
                    ),
                };
            } catch (error) {
                console.error("[mock-server] 解密消息失败:", error);
                return;
            }
        }

        const text = message.buffer ? decoder.decode(message.buffer) : "";
        console.log(`[mock-server] 收到消息 route=${message.route} seq=${message.seq} data=${text}`);

        // 回显消息（保留 route 与 seq，用于 request/response）
        const payload = encoder.encode(JSON.stringify({
            code: 0,
            message: "pong",
            data: text ? JSON.parse(text) : null,
        }));

        // 安全会话已建立 -> 加密响应
        const response = session
            ? {
                seq: message.seq,
                route: message.route,
                buffer: session.seal(payload, Direction.ServerToClient, message.route, message.seq || 0),
            }
            : {
                seq: message.seq,
                route: message.route,
                buffer: payload,
            };

        ws.send(Buffer.from(packer.packMessage(response)));
    });

    ws.on("close", () => {
        console.log("[mock-server] 客户端断开连接");
    });

    ws.on("error", (error) => {
        console.log("[mock-server] socket 错误:", error.message);
    });
});

console.log(`[mock-server] mock due server listening on ws://127.0.0.1:${PORT}`);
console.log("[mock-server] 支持会话安全；将以下公钥粘贴到 example/src/Demo.ts 的 SERVER_PUBLIC_KEY：");
console.log(publicKeyPem);
