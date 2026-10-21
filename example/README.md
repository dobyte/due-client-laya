# due-client-laya 示例工程

一个可运行的 LayaAir 3.x 示例，演示 [due-client-laya](../README.md) 客户端 SDK 的完整用法：连接、心跳、异步消息（`send`）、请求响应（`request`）以及可选的会话安全（`security`）。

## 目录结构

```
example/
├── src/
│   ├── due/            # due 客户端 SDK（packer / client / security / index）
│   ├── laya.d.ts       # LayaAir 3.x 最小类型声明（仅用于独立类型检查）
│   └── Demo.ts         # 启动脚本（导出 main 函数）
├── tsconfig.json
└── server/             # 用于联调的 mock due WebSocket 服务器
    ├── mock-server.ts  # 支持明文与安全握手两种模式
    ├── package.json
    └── tsconfig.json
```

## 一、准备 mock 服务器（可选，用于无 Go 服务端时联调）

如果你已有真实的 due 服务器（监听 `ws://127.0.0.1:3553`），可跳过本步。

```bash
cd example/server
npm install
npm start
```

启动后：

- 监听 `ws://127.0.0.1:3553`，对客户端请求回显 `{"code":0,"message":"pong",...}`，并回复带时间戳的心跳；
- 首次启动会生成 ECDSA P-256 测试密钥（`key.pem` / `key.pub.pem`，仅用于本地联调），并打印公钥；
- 同时支持明文客户端与开启 `security` 的客户端，收到握手帧时自动完成 ClientHello / ServerHello / Finished 流程。

## 二、在 LayaAir IDE 中运行

1. 打开 **LayaAir IDE 3.2+**，新建一个 LayaAir 3.x 项目（类型任选，2D/3D 均可）。
2. 将本 `example/src` 目录下的所有文件拷贝到工程 `src` 目录：
   - 拷贝 `due/` 目录到 `src/due/`
   - 拷贝 `Demo.ts` 到 `src/Demo.ts`
   - `laya.d.ts` 可不用拷贝（LayaAir 工程已有引擎类型声明）。
3. 打开 **构建发布** 面板，在「启动脚本」中选择 `Demo.ts`（或 `src/Demo.ts`）。
4. 点击 **运行** 即可看到屏幕日志输出。

> 说明：本示例使用启动脚本（`export async function main()`）作为入口，LayaAir 3.2 及以上版本支持；若使用更早的 3.0/3.1，可将 `main` 内的逻辑移到 `Main.ts` 的 `onStart()` 中。

## 三、验证行为

运行后，控制台与屏幕会依次输出类似：

```
连接服务器: ws://127.0.0.1:3553
连接成功
收到响应: {"code":0,"message":"pong","data":{"message":"hello due"}}
服务器心跳时间: 1760000000000
...
```

断掉服务器后，客户端会输出「连接断开，3 秒后重连...」并自动重连。

## 四、启用会话安全

1. 启动 mock 服务，复制终端打印的公钥（或使用真实网关的 `key.pub.pem` 内容）。
2. 在 `src/Demo.ts` 中设置：

```ts
// 开启会话安全
const SECURITY_ENABLED = true;

// 填入 mock 服务打印的公钥
const SERVER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
-----END PUBLIC KEY-----`;
```

3. 重新运行，输出会变为：

```
连接服务器: ws://127.0.0.1:3553
已开启会话安全，等待握手...
握手完成，连接成功
收到响应: {"code":0,"message":"pong","data":{"message":"hello due"}}
```

握手完成后业务消息自动加解密；公钥未填写时会回退为明文连接。真实网关使用 RSA 签名时，将 `Verifier.ecdsa(...)` 换成 `Verifier.rsa(...)`，哈希算法需与网关 `[crypto.*.signer] hash` 配置一致。

## 五、独立类型检查（不使用 IDE 时）

```bash
# 客户端示例
cd example
npx tsc -p tsconfig.json

# mock 服务
cd server
npx tsc -p tsconfig.json
```

## 六、修改服务器地址 / 协议参数

在 `src/Demo.ts` 中修改 `SERVER_URL`，以及 `new Packer({...})` 的 `byteOrder` / `seqBytes` / `routeBytes` / `bufferBytes`，使其与你的 due 服务器配置一致。修改后需同步 `example/server/mock-server.ts` 中的 Packer 配置。
