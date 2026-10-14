/**
 * 用于测试 due-client-laya 的 mock due WebSocket 服务器。
 *
 * 协议与客户端 Packer 保持一致（大端序）：
 *   - 客户端发来的消息: [4字节size][1字节header=0][route(2字节)][seq(2字节)][buffer...]
 *   - 客户端发来的心跳: [4字节size=1][1字节header=0x80]
 *   - 服务器回的心跳:   [4字节size=9][1字节header=0x80][8字节时间戳]
 *   - 服务器回的响应:   [4字节size][1字节header=0][route(2字节)][seq(2字节)][buffer...]
 *
 * 使用:
 *   cd example/server && npm install && npm start
 */
const { WebSocketServer } = require("ws");

const PORT = 3553;
const ROUTE_BYTES = 2;
const SEQ_BYTES = 2;

const wss = new WebSocketServer({ port: PORT });

/**
 * 解包客户端发来的数据
 */
function unpack(data) {
    let offset = 0;
    const size = data.readUInt32BE(offset);
    offset += 4;

    const header = data.readUInt8(offset);
    offset += 1;

    const isHeartbeat = (header >> 7) === 1;

    if (isHeartbeat) {
        return { isHeartbeat };
    }

    const route = data.readInt16BE(offset);
    offset += ROUTE_BYTES;

    const seq = data.readInt16BE(offset);
    offset += SEQ_BYTES;

    const buffer = data.subarray(offset, size + 4);

    return { isHeartbeat: false, message: { route, seq, buffer } };
}

/**
 * 打包消息
 */
function packMessage(route, seq, body) {
    const size = 1 + ROUTE_BYTES + SEQ_BYTES + body.length;
    const buf = Buffer.alloc(4 + size);

    let offset = 0;
    buf.writeUInt32BE(size, offset);
    offset += 4;

    buf.writeUInt8(0, offset);
    offset += 1;

    buf.writeInt16BE(route, offset);
    offset += ROUTE_BYTES;

    buf.writeInt16BE(seq, offset);
    offset += SEQ_BYTES;

    body.copy(buf, offset);

    return buf;
}

/**
 * 打包带服务器时间戳的心跳
 */
function packHeartbeat() {
    const buf = Buffer.alloc(4 + 1 + 8);

    buf.writeUInt32BE(9, 0);
    buf.writeUInt8(0x80, 4);
    buf.writeBigUInt64BE(BigInt(Date.now()), 5);

    return buf;
}

wss.on("connection", (ws) => {
    console.log("client connected");

    ws.on("message", (data) => {
        const packet = unpack(data);

        if (packet.isHeartbeat) {
            console.log("heartbeat received");
            // 回复带服务器时间戳的心跳，用于触发客户端 onHeartbeat 回调
            ws.send(packHeartbeat());
            return;
        }

        const { route, seq, buffer } = packet.message;
        const body = buffer.toString("utf8");
        console.log(`message route=${route} seq=${seq} body=${body}`);

        // 回显：返回相同 route + seq，使客户端 request 的 Promise 得以 resolve
        const response = Buffer.from(
            JSON.stringify({
                code: 0,
                message: "pong",
                data: body ? JSON.parse(body) : null
            }),
            "utf8"
        );

        ws.send(packMessage(route, seq, response));
    });

    ws.on("close", () => {
        console.log("client disconnected");
    });

    ws.on("error", (err) => {
        console.log("socket error:", err.message);
    });
});

console.log(`mock due server listening on ws://127.0.0.1:${PORT}`);
