/**
 * LayaAir 3.x 运行时最小声明。
 *
 * 仅声明本示例依赖的 API 子集，用于脱离 LayaAir IDE 时独立进行类型检查。
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
        disableInput: boolean;
        readonly input: any;
        readonly output: any;
        readonly connected: boolean;
        endian: string;

        constructor(host?: string, port?: number, protocols?: string[], isSecure?: boolean);
        connectByUrl(url: string, protocols?: string[]): void;
        connect(host: string, port: number, isSecure?: boolean, protocols?: string[]): void;
        send(data: string | ArrayBuffer): Promise<void>;
        close(): void;
        flush(): void;
    }

    /** 时钟管理单例 */
    const timer: Timer;

    class Timer {
        loop(delay: number, caller: any, method: Function, args?: any[], coverBefore?: boolean, jumpFrame?: boolean): void;
        once(delay: number, caller: any, method: Function, args?: any[], coverBefore?: boolean): void;
        clear(caller: any, method: Function): void;
        clearAll(caller: any): void;
    }

    /** 舞台（示例中仅用于挂载文本） */
    class Stage {
        addChild(node: any): any;
        readonly width: number;
        readonly height: number;
    }
    const stage: Stage;

    /** 2D 文本节点（示例中用于屏幕日志） */
    class Text {
        text: string;
        fontSize: number;
        color: string;
        bold: boolean;
        wordWrap: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
        pos(x: number, y: number): void;
    }
}
