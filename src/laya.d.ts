/**
 * LayaAir 3.x 运行时最小声明。
 *
 * 仅声明本 SDK 依赖的 API 子集，用于脱离 LayaAir 工程时独立进行类型检查。
 * 在真实的 LayaAir 工程中，Laya 命名空间已由引擎提供：
 *  - 可以删除此文件；
 *  - 也可以保留，由于声明内容与引擎一致，会与引擎声明合并而不会冲突。
 */
declare namespace Laya {
    /** 事件常量 */
    class Event {
        static readonly OPEN: string;
        static readonly CLOSE: string;
        static readonly MESSAGE: string;
        static readonly ERROR: string;
    }

    /** 事件派发器 */
    class EventDispatcher {
        on(type: string, caller: any, listener: Function, args?: any[]): EventDispatcher;
        on(type: string, listener: Function): EventDispatcher;
        offAll(type?: string): EventDispatcher;
        offAllCaller(caller: any): EventDispatcher;
    }

    /** WebSocket 客户端 */
    class Socket extends EventDispatcher {
        /** 是否禁用服务端发来的数据缓存 */
        disableInput: boolean;
        /** 服务端发来的缓存数据 */
        readonly input: any;
        /** 需要发送至服务端的缓冲区中的数据 */
        readonly output: any;
        /** 此 Socket 对象目前是否已连接 */
        readonly connected: boolean;
        /** 此 Socket 对象使用的字节序 */
        endian: string;

        constructor(host?: string, port?: number, protocols?: string[], isSecure?: boolean);

        /** 连接到指定的服务端 WebSocket URL */
        connectByUrl(url: string, protocols?: string[]): void;
        /** 连接到指定的主机和端口 */
        connect(host: string, port: number, isSecure?: boolean, protocols?: string[]): void;
        /** 发送数据到服务器 */
        send(data: string | ArrayBuffer): Promise<void>;
        /** 关闭连接 */
        close(): void;
        /** 发送缓冲区中的数据到服务器 */
        flush(): void;
    }

    /** 时钟管理单例 */
    const timer: Timer;

    class Timer {
        /** 定时重复执行（毫秒） */
        loop(delay: number, caller: any, method: Function, args?: any[], coverBefore?: boolean, jumpFrame?: boolean): void;
        /** 定时执行一次（毫秒） */
        once(delay: number, caller: any, method: Function, args?: any[], coverBefore?: boolean): void;
        /** 清理定时器 */
        clear(caller: any, method: Function): void;
        /** 清理对象身上的所有定时器 */
        clearAll(caller: any): void;
    }
}
