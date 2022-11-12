export default class AsyncBlockingQueue<T> {
    private _promises;
    private _resolvers;
    constructor();
    private _add;
    enqueue(t: T): void;
    dequeue(): Promise<T>;
    isEmpty(): boolean;
    isBlocked(): boolean;
    get length(): number;
}
//# sourceMappingURL=AsyncBlockingQueue.d.ts.map