import { Packer, Message, Packet } from "./packer";

export interface ClientOptions {
    // 连接地址
    url: string;
    // 打包器
    packer: Packer;
    // 心跳间隔，大于0则开启心跳
    heartbeat: number;
}

/**
 * 连接打开回调
 */
export interface ConnectHandler {
    (client: Client): any
}

/**
 * 连接关闭回调
 */
export interface DisconnectHandler {
    (client: Client): any
}

/**
 * 接收消息回调
 */
export interface ReceiveHandler {
    (client: Client, message: Message): any
}

/**
 * 错误回调
 */
export interface ErrorHandler {
    (client: Client): any
}

/**
 * 心跳回调
 */
export interface HeartbeatHandler {
    (client: Client, millisecond?: number): any
}

/**
 * 客户端
 */
export class Client {
    // 连接打开hook函数
    private connectHandler?: ConnectHandler;
    // 连接关闭hook函数
    private disconnectHandler?: DisconnectHandler;
    // 接收消息hook函数
    private receiveHandler?: ReceiveHandler;
    // 错误处理hook函数
    private errorHandler?: ErrorHandler;
    // 心跳处理hook函数
    private heartbeatHandler?: HeartbeatHandler;
    // 客户端配置
    private opts: ClientOptions;
    // LayaAir Socket
    private socket?: Laya.Socket;
    // 是否正在连接
    private connecting: boolean;
    // 打包器
    private packer: Packer;
    // 同步等待组
    private waitgroup: Map<number, {
        seq: number;
        callback: Map<number, (message: Message) => void>
    }>;

    public constructor(opts: ClientOptions) {
        this.opts = opts;
        this.socket = undefined;
        this.connecting = false;
        this.packer = opts.packer;
        this.waitgroup = new Map();
    }

    /**
     * 连接服务器
     * @returns boolean
     */
    public connect(): boolean {
        try {
            this.disconnect();

            // 新建LayaAir Socket
            const socket = new Laya.Socket();
            // 二进制消息直接以 ArrayBuffer 下发，无需引擎缓存到 input
            socket.disableInput = true;
            this.socket = socket;
            this.connecting = true;

            // 监听连接打开
            socket.on(Laya.Event.OPEN, this, () => {
                this.connecting = false;
                this.heartbeat();

                this.connectHandler && this.connectHandler(this);
            });

            // 监听连接关闭
            socket.on(Laya.Event.CLOSE, this, () => {
                // 忽略已被新连接替换的旧socket的关闭事件
                if (this.socket !== socket) {
                    return;
                }

                this.connecting = false;
                this.stopHeartbeat();

                this.disconnectHandler && this.disconnectHandler(this);
            });

            // 监听连接错误
            socket.on(Laya.Event.ERROR, this, () => {
                this.connecting = false;

                this.errorHandler && this.errorHandler(this);
            });

            // 监听消息
            socket.on(Laya.Event.MESSAGE, this, (data: any) => {
                this.handleMessage(data);
            });

            socket.connectByUrl(this.opts.url);

            return true;
        } catch (error) {
            console.log(error);
            return false;
        }
    }

    /**
     * 断开连接
     * @returns void
     */
    public disconnect(): void {
        if (!this.socket) {
            return;
        }

        this.stopHeartbeat();
        this.connecting = false;

        this.socket.close();
    }

    /**
     * 停止心跳
     * @returns void
     */
    private stopHeartbeat(): void {
        Laya.timer.clear(this, this.onHeartbeatTick);
    }

    /**
     * 启动心跳
     * @returns void
     */
    private heartbeat(): void {
        if (!this.opts.heartbeat || this.opts.heartbeat <= 0) {
            return;
        }

        Laya.timer.loop(this.opts.heartbeat, this, this.onHeartbeatTick);
    }

    /**
     * 心跳定时回调
     * @returns void
     */
    private onHeartbeatTick(): void {
        if (this.isConnected() && this.socket) {
            this.socket.send(this.packer.packHeartbeat());
        }
    }

    /**
     * 处理接收到的消息
     * @param data 二进制数据
     * @returns void
     */
    private handleMessage(data: any): void {
        if (!(data instanceof ArrayBuffer) || data.byteLength === 0) {
            return;
        }

        let packet: Packet;

        try {
            packet = this.packer.unpack(data);
        } catch (error) {
            this.errorHandler && this.errorHandler(this);
            return;
        }

        if (packet.isHeartbeat) {
            this.heartbeatHandler && this.heartbeatHandler(this, packet.millisecond);
        } else if (packet.message) {
            (this.invoke(packet.message)) || (this.receiveHandler && this.receiveHandler(this, packet.message));
        }
    }

    /**
     * 设置连接处理器
     * @param handler ConnectHandler
     */
    public onConnect(handler: ConnectHandler): void {
        this.connectHandler = handler;
    }

    /**
     * 设置断开连接处理器
     * @param handler DisconnectHandler
     */
    public onDisconnect(handler: DisconnectHandler): void {
        this.disconnectHandler = handler;
    }

    /**
     * 设置消息接收处理器
     * @param handler ReceiveHandler
     */
    public onReceive(handler: ReceiveHandler): void {
        this.receiveHandler = handler;
    }

    /**
     * 设置错误处理器
     * @param handler ErrorHandler
     */
    public onError(handler: ErrorHandler): void {
        this.errorHandler = handler;
    }

    /**
     * 设置心跳处理器
     * @param handler HeartbeatHandler
     */
    public onHeartbeat(handler: HeartbeatHandler): void {
        this.heartbeatHandler = handler;
    }

    /**
     * 检测客户端是否已连接
     * @returns boolean
     */
    public isConnected(): boolean {
        return this.socket !== undefined && this.socket.connected;
    }

    /**
     * 检测客户端是否正在连接
     * @returns boolean
     */
    public isConnecting(): boolean {
        return this.connecting;
    }

    /**
     * 发送消息
     * @param message Message 消息
     * @returns boolean
     */
    public send(message: Message): boolean {
        if (this.isConnected() && this.socket) {
            this.socket.send(this.packer.packMessage(message));

            return true;
        }

        return false;
    }

    /**
     * 请求C/S模型，需要客户端和服务器同时开启seq配置支持
     * @param route 路由
     * @param buffer 数据
     * @param timeout 超时时间（毫秒），大于0时生效
     * @returns Promise<Message> 服务器响应消息
     */
    public request(route: number, buffer?: Uint8Array, timeout?: number): Promise<Message> {
        return new Promise((resolve, reject) => {
            if (!this.isConnected()) {
                reject(new Error('client not connected'));
                return;
            }

            let group = this.waitgroup.get(route);

            if (group === undefined) {
                group = { seq: 0, callback: new Map() };
                this.waitgroup.set(route, group);
            }

            let seq = ++group.seq;
            let timeoutId: any;
            let cleanup = () => {
                group!.callback.delete(seq);
            };

            if (timeout && timeout > 0) {
                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error('request timeout'));
                }, timeout);
            }

            group.callback.set(seq, (message: Message) => {
                timeoutId && clearTimeout(timeoutId);

                resolve(message);
            });

            try {
                if (!this.send({ seq, route, buffer })) {
                    timeoutId && clearTimeout(timeoutId);
                    cleanup();

                    reject(new Error('send message failed'));
                    return;
                }
            } catch (error) {
                timeoutId && clearTimeout(timeoutId);
                cleanup();

                reject(error);
            }
        });
    }

    /**
     * 调用回调
     * @param message 消息
     * @returns 回调结果
     */
    private invoke(message: Message): boolean {
        if (message.seq === undefined || message.seq === 0) {
            return false;
        }

        const group = this.waitgroup.get(message.route);

        if (group === undefined) {
            return false;
        }

        const callback = group.callback.get(message.seq || 0);

        group.callback.delete(message.seq || 0);

        callback && callback(message);

        return true;
    }
}
