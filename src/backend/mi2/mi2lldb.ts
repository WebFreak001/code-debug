import { MI2, escape } from "./mi2";
import { Breakpoint } from "../backend";
import * as ChildProcess from "child_process";
import * as path from "path";

export class MI2_LLDB extends MI2 {
	protected override initCommands(target: string, cwd: string, attach: boolean = false) {
		// We need to account for the possibility of the path type used by the debugger being different
		// than the path type where the extension is running (e.g., SSH from Linux to Windows machine).
		// Since the CWD is expected to be an absolute path in the debugger's environment, we can test
		// that to determine the path type used by the debugger and use the result of that test to
		// select the correct API to check whether the target path is an absolute path.
		const debuggerPath = path.posix.isAbsolute(cwd) ? path.posix : path.win32;

		if (!debuggerPath.isAbsolute(target))
			target = debuggerPath.join(cwd, target);

		const cmds = [
			this.sendCommand("gdb-set target-async on"),
			new Promise(resolve => {
				this.sendCommand("list-features").then(done => {
					this.features = done.result("features");
					resolve(undefined);
				}, err => {
					this.features = [];
					resolve(undefined);
				});
			})
		];
		if (!attach)
			cmds.push(this.sendCommand("file-exec-and-symbols \"" + escape(target) + "\""));
		for (const cmd of this.extraCommands) {
			cmds.push(this.sendCliCommand(cmd));
		}
		return cmds;
	}

	override attach(cwd: string, executable: string, target: string, autorun: string[]): Thenable<any> {
		return new Promise((resolve, reject) => {
			const args = this.preargs.concat(this.extraargs || []);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", () => this.emit("quit"));
			this.process.on("error", err => this.emit("launcherror", err));
			const promises = this.initCommands(target, cwd, true);
			promises.push(this.sendCommand("file-exec-and-symbols \"" + escape(executable) + "\""));
			promises.push(this.sendCommand("target-attach " + target));
			promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
			Promise.all(promises).then(() => {
				this.emit("debug-ready");
				resolve(undefined);
			}, reject);
		});
	}

	override setBreakPointCondition(bkptNum: number, condition: string): Thenable<any> {
		return this.sendCommand("break-condition " + bkptNum + " \"" + escape(condition) + "\" 1");
	}

	override goto(filename: string, line: number): Thenable<Boolean> {
		return new Promise((resolve, reject) => {
			// LLDB parses the file differently than GDB...
			// GDB doesn't allow quoting only the file but only the whole argument
			// LLDB doesn't allow quoting the whole argument but rather only the file
			const target: string = (filename ? '"' + escape(filename) + '":' : "") + line;
			this.sendCliCommand("jump " + target).then(() => {
				this.emit("step-other", undefined);
				resolve(true);
			}, reject);
		});
	}
}
