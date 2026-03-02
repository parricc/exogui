import { ChildProcess, spawn } from "child_process";
import * as net from "net";

export class VlcPlayer {
    server: ChildProcess | null = null;
    filepath: string = "";
    private socket: net.Socket | null = null;
    private commandQueue: { command: string; resolve: (value: string) => void; reject: (reason?: any) => void }[] = [];
    private isProcessingQueue: boolean = false;
    private isSocketConnected: boolean = false;
    private firstPlay: boolean = true;

    constructor(
        private vlcPath: string,
        private args: string[],
        private port: number,
        private initialVol: number,
    ) {
        const fullArgs = [...this.args, "-I", "rc", "--rc-host", `127.0.0.1:${port}`];
        console.log(`VLC: starting process "${vlcPath}" with args: ${fullArgs.join(" ")}`);
        this.server = spawn(this.vlcPath, fullArgs, { windowsHide: true });
        this.server.on("spawn", () => {
            console.log(`VLC: process spawned (pid ${this.server?.pid})`);
        });
        this.server.on("error", (err) => {
            console.log(`VLC: failed to start — ${err}`);
            this.server = null;
        });
        this.server.on("exit", (code, signal) => {
            console.log(`VLC: process exited (code=${code}, signal=${signal})`);
        });
    }

    private async connectSocket(): Promise<void> {
        if (this.socket && this.isSocketConnected) {
            return;
        }
        if (!this.server) {
            return;
        }

        console.log(`VLC: connecting to RC socket on port ${this.port}`);
        return new Promise((resolve, reject) => {
            this.socket = net.connect(this.port, "127.0.0.1", () => {
                console.log("VLC: RC socket connected");
                this.isSocketConnected = true;
                resolve();
            });

            this.socket.on("error", (err) => {
                console.log(`VLC: RC socket error — ${err}`);
                this.isSocketConnected = false;
                reject(err);
            });

            this.socket.on("close", () => {
                console.log("VLC: RC socket closed");
                this.isSocketConnected = false;
            });
        });
    }

    private async sendCommand(command: string): Promise<string> {
        await this.connectSocket();
        if (!this.socket) {
            throw new Error("VLC not available");
        }

        return new Promise((resolve, reject) => {
            this.commandQueue.push({ command, resolve, reject });

            if (!this.isProcessingQueue) {
                this.processQueue();
            }
        });
    }

    private processQueue() {
        if (this.commandQueue.length === 0) {
            this.isProcessingQueue = false;
            return;
        }

        this.isProcessingQueue = true;
        const { command, resolve, reject } = this.commandQueue.shift()!;

        this.socket?.write(command + "\n");

        const onData = (data: Buffer) => {
            resolve(data.toString());
            this.socket?.removeListener("data", onData);
            this.processQueue();
        };

        this.socket?.on("data", onData);

        this.socket?.on("error", (err) => {
            reject(err);
            this.socket?.removeListener("data", onData);
            this.processQueue();
        });
    }

    private async _play() {
        if (this.filepath) {
            console.log(`VLC: playing "${this.filepath}"`);
            await this.sendCommand("clear");
            await this.sendCommand(`add "${this.filepath}"`);
            if (this.firstPlay) {
                this.firstPlay = false;
                setTimeout(() => {
                    this.setVol(this.initialVol);
                }, 100);
            }
        } else {
            await this.stop();
        }
    }

    async setVol(vol: number): Promise<void> {
        this.initialVol = vol;
        const vlcVol = Math.floor(Math.max(0, Math.min(1, vol)) * 256);
        console.log(`VLC: setting volume to ${vlcVol}`);
        await this.sendCommand(`volume ${vlcVol}`);
    }

    setFile(filepath: string) {
        this.filepath = filepath;
    }

    async resume(): Promise<void> {
        console.log("VLC: resuming");
        await this._play();
    }

    async play(filepath: string): Promise<void> {
        this.filepath = filepath;
        await this._play();
    }

    async stop(): Promise<void> {
        console.log("VLC: stopping");
        await this.sendCommand("stop");
        this.firstPlay = true;
    }

    async close(): Promise<void> {
        if (this.socket) {
            this.socket.end();
            this.socket = null;
            this.isSocketConnected = false;
        }
    }

    async quit(): Promise<void> {
        console.log("VLC: quitting");
        try {
            await this.sendCommand("quit");
        } catch {
            // VLC may not be connected yet or already gone
        }
        await this.close();
        this.server?.kill();
    }
}
