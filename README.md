# due-client-laya

基于 TypeScript 编写的 [due](https://github.com/dobyte/due) 游戏服务器框架的 LayaAir 客户端 SDK。

相对于浏览器版 [due-client-ts](https://github.com/dobyte/due-client-ts)，本 SDK 做了以下适配：

- 使用 `Laya.Socket` 建立 WebSocket 连接（兼容 LayaAir 的 Web / 小游戏 / 原生等运行时）。
- 使用 `Laya.timer` 维护心跳（随游戏主时钟运行）。
- 二进制打包/解包使用标准 `ArrayBuffer` / `DataView`，并对服务器时间戳采用可移植的 64 位读取方式，避免依赖 `BigUint64`（部分小游戏运行时不支持）。

## 安装

将 `src` 目录下的源码拷贝到你的 LayaAir 工程中（例如工程 `src/due` 目录），由 LayaAir IDE 统一编译即可。

```bash
# 也可用于独立类型检查
npm install
npm run build
```

## 使用

```ts
import { Client, Packer } from './due';

// 请求数据包
const buffer = new TextEncoder().encode(JSON.stringify({
    message: 'hello server'
}));

// 创建客户端
const client = new Client({
    url: 'ws://127.0.0.1:3553',
    heartbeat: 10000,
    packer: new Packer({
        byteOrder: 'big',
        seqBytes: 0,
        routeBytes: 4,
        bufferBytes: 5000
    })
});

// 发送请求响应（需客户端和服务器同时开启 seq 配置）
const request = (c: Client) => {
    let counter = 0;

    Laya.timer.loop(1000, null, () => {
        if (counter >= 10) {
            Laya.timer.clear(null, arguments.callee as any);
            c.disconnect();
            return;
        }

        try {
            c.request(1, buffer, 2000).then((message) => {
                console.log('response message: ', new TextDecoder().decode(message.buffer));
            }).catch(() => {
                console.log('reject');
            });

            counter++;
        } catch (error) {
            console.log(error);
        }
    });
};

// 发送异步消息
const send = (c: Client) => {
    let counter = 0;

    Laya.timer.loop(1000, null, () => {
        if (counter >= 10) {
            c.disconnect();
            return;
        }

        try {
            c.send({
                route: 1,
                buffer: buffer
            });

            counter++;
        } catch (error) {
            console.log(error);
        }
    });
};

// 监听连接
client.onConnect((c) => {
    console.log('connect success');

    // 发送同步请求，需要客户端和服务器同时开启seq配置
    request(c);

    // 发送异步消息
    // send(c);
});

// 监听连接断开
client.onDisconnect((c) => {
    console.log('disconnect success');

    // 重新连接
    c.connect();
});

// 监听接收到消息
client.onReceive((c, message) => {
    console.log('receive message: ', new TextDecoder().decode(message.buffer));
});

// 监听接受服务器的心跳附带的服务器时间
client.onHeartbeat((c, millisecond) => {
    millisecond && console.log('server heartbeat timestamp: ', millisecond);
});

// 建立连接
client.connect();
```

## API

### Packer

- `new Packer(options?)`：创建打包器，`options` 支持 `byteOrder`、`seqBytes`、`routeBytes`、`bufferBytes`。
- `packMessage(message)`：打包消息为 `ArrayBuffer`。
- `packHeartbeat()`：返回心跳包 `ArrayBuffer`。
- `unpack(data)`：解包为 `Packet`。

### Client

- `new Client(options)`：创建客户端，`options` 包含 `url`、`packer`、`heartbeat`。
- `connect()`：建立连接。
- `disconnect()`：断开连接。
- `send(message)`：发送异步消息。
- `request(route, buffer?, timeout?)`：发送请求并返回 `Promise<Message>`。
- `isConnected()` / `isConnecting()`：连接状态查询。
- `onConnect` / `onDisconnect` / `onReceive` / `onError` / `onHeartbeat`：注册回调。

## License

[MIT](https://tldrlegal.com/license/mit-license)
