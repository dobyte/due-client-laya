import { Client, Packer, Message } from "./due";

// 服务器地址，可在此修改
const SERVER_URL = "ws://127.0.0.1:3553";

// 屏幕日志
let logText: Laya.Text;
let logLines: string[] = [];

function log(msg: string): void {
    logLines.push(msg);
    if (logLines.length > 20) {
        logLines.shift();
    }
    logText.text = logLines.join("\n");
    console.log(msg);
}

/**
 * LayaAir 启动脚本入口。
 * 引擎初始化完成后会直接调用此函数（需在 IDE 的“构建发布”面板将本脚本设置为“启动脚本”）。
 */
export async function main() {
    // 在屏幕上显示日志
    logText = new Laya.Text();
    logText.pos(20, 20);
    logText.fontSize = 22;
    logText.color = "#ffffff";
    logText.wordWrap = false;
    Laya.stage.addChild(logText);

    log(`连接服务器: ${SERVER_URL}`);

    // 请求数据
    const buffer = new TextEncoder().encode(JSON.stringify({ message: "hello due" }));

    // 创建客户端
    const client = new Client({
        url: SERVER_URL,
        heartbeat: 10000,
        packer: new Packer({
            byteOrder: "big",
            seqBytes: 2,
            routeBytes: 2,
            bufferBytes: 5000
        })
    });

    // 连接成功
    client.onConnect((c) => {
        log("连接成功");
    });

    // 连接断开后自动重连
    client.onDisconnect((c) => {
        log("连接断开，3 秒后重连...");
        Laya.timer.once(3000, null, () => {
            c.connect();
        });
    });

    // 收到服务端主动推送的消息
    client.onReceive((c, message: Message) => {
        log(`收到推送(route=${message.route}): ${new TextDecoder().decode(message.buffer)}`);
    });

    // 收到服务器心跳附带的服务器时间
    client.onHeartbeat((c, millisecond) => {
        if (millisecond) {
            log(`服务器心跳时间: ${millisecond}`);
        }
    });

    // 连接错误
    client.onError((c) => {
        log("连接错误");
    });

    // 建立连接
    client.connect();

    // 每 1 秒发送一次请求（未连接时 request 会拒绝，不影响后续）
    Laya.timer.loop(1000, null, () => {
        client.request(1, buffer, 2000).then((message) => {
            log(`收到响应: ${new TextDecoder().decode(message.buffer)}`);
        }).catch((err) => {
            log(`请求失败: ${err.message}`);
        });
    });
}
