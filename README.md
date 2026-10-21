# due-client-laya

基于 TypeScript 编写的 [due](https://github.com/dobyte/due) 游戏服务器框架的 LayaAir 客户端 SDK。

相对于浏览器版 [due-client-ts](https://github.com/dobyte/due-client-ts)，本 SDK 做了以下适配：

- 使用 `Laya.Socket` 建立 WebSocket 连接（兼容 LayaAir 的 Web / 小游戏 / 原生等运行时）。
- 使用 `Laya.timer` 维护心跳（随游戏主时钟运行）。
- 二进制打包/解包使用标准 `ArrayBuffer` / `DataView`，并对服务器时间戳采用可移植的 64 位读取方式，避免依赖 `BigUint64`（部分小游戏运行时不支持）。
- 可选会话安全（`security`）：适配 due 网关的会话安全握手，支持服务端签名校验、X25519 密钥交换与 AEAD 加解密（纯 TypeScript 实现，无第三方依赖）。

## 安装

将 `src` 目录下的源码拷贝到你的 LayaAir 工程中（例如工程 `src/due` 目录），由 LayaAir IDE 统一编译即可。

```bash
# 也可用于独立类型检查
npm install
npm run build
```

> 会话安全（`security`）使用 `BigInt` 实现密码学原语，要求 TypeScript 编译目标为 **ES2020 及以上**（LayaAir 工程的 `tsconfig.json` 中设置 `"target": "ES2020"`），且运行平台支持 BigInt。安全模块会随 SDK 一起编译；若目标平台不支持 BigInt（如较旧的 iOS 微信小游戏），请勿引入 `security` 目录。

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

## 会话安全（security）

网关通过 `WithSessionSecurity` 开启会话安全后，客户端配置 `security` 即可。握手成功后才触发 `onConnect`，此后 `send` / `request` 的业务载荷自动加解密。

```ts
import { Client, Packer } from './due';
import { Verifier } from './due/security';

const client = new Client({
    url: 'ws://127.0.0.1:3553',
    heartbeat: 10000,
    packer: new Packer(),
    security: {
        // 服务端签名校验器；网关使用 RSA 时改为 Verifier.rsa(pem)
        verifier: Verifier.ecdsa(`-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
-----END PUBLIC KEY-----`),
        // 可选：协商套件，1=AES-256-GCM，2=ChaCha20-Poly1305；默认两者都参与协商
        suites: [1, 2],
        // 可选：握手超时（毫秒），默认 5000，小于等于 0 表示不限制
        handshakeTimeout: 5000,
        // 可选：自定义随机字节源（原生平台未提供 crypto.getRandomValues 时注入）
        // random: (length) => fillSecureRandom(length),
    },
});

client.onConnect(() => {
    // 握手完成后 send / request 自动加密
    client.send({ route: 1, buffer: new TextEncoder().encode('hello secure server') });
});

client.connect();
```

- `Verifier.ecdsa(publicKey, hash?, delimiter?)`：默认 SHA-256、空格分隔；曲线支持 P-256 / P-384 / P-521。
- `Verifier.rsa(publicKey, hash?, pss?)`：默认 SHA-256 + PSS；`pss = false` 时使用 PKCS#1 v1.5。
- 公钥入参支持 PEM、base64、DER `Uint8Array`；`hash` 需与网关 `[crypto.ecc.signer] hash` / `[crypto.rsa.signer] hash` 配置一致。
- 自定义校验逻辑（必须同步返回 `boolean`）：

```ts
import type { HandshakeVerifier } from './due/security';

const custom: HandshakeVerifier = (data, signature) => true;
```

- 握手失败会关闭连接并触发 `onError`（随后触发 `onDisconnect`）；每次 `connect()` 都会重新握手，会话密钥不复用。
- 握手帧与心跳帧为明文；开启安全后单条业务消息额外增加 25 字节封包开销（epoch 1 + counter 8 + tag 16），需保证 `bufferBytes` 足够。
- 会话密钥由 X25519 共享密钥经 HKDF-SHA256 派生；AEAD 的 AAD 绑定 version / direction / epoch / route / seq，接收端使用 64 位重放窗口拒绝重放消息。

## API

### Packer

- `new Packer(options?)`：创建打包器，`options` 支持 `byteOrder`、`seqBytes`、`routeBytes`、`bufferBytes`。
- `packMessage(message)`：打包消息为 `ArrayBuffer`。
- `packHandshake(payload)`：打包安全握手帧为 `ArrayBuffer`。
- `packHeartbeat()`：返回心跳包 `ArrayBuffer`。
- `unpack(data)`：解包为 `Packet`，`Packet` 包含 `isHeartbeat`、`isHandshake`、`millisecond`、`handshake`、`message`。

### Client

- `new Client(options)`：创建客户端，`options` 包含 `url`、`packer`、`heartbeat`，以及可选的 `security`（见上文）。
- `connect()`：建立连接；启用 `security` 时在握手完成后触发 `onConnect`。
- `disconnect()`：断开连接。
- `send(message)`：发送异步消息。
- `request(route, buffer?, timeout?)`：发送请求并返回 `Promise<Message>`。
- `isConnected()` / `isConnecting()`：连接状态查询。
- `onConnect` / `onDisconnect` / `onReceive` / `onError` / `onHeartbeat`：注册回调。

## 测试

security 模块内置单元测试，覆盖密码学测试向量、服务端签名校验、握手流程与会话加解密：

```bash
npm test               # 运行 security 单元测试
npm run test:typecheck # 测试文件类型检查
```

## License

[MIT](https://tldrlegal.com/license/mit-license)
