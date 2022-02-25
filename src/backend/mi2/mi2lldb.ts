import { MI2, escape } from "./mi2";
import { Breakpoint } from "../backend";
import * as ChildProcess from "child_process";
import { posix } from "path";
import * as nativePath from "path";
const path = posix;

export class MI2_LLDB extends MI2 {
	protected initCommands(target: string, cwd: string, ssh: boolean = false, attach: boolean = false) {
		if (ssh) {
			if (!path.isAbsolute(target))
				target = path.join(cwd, target);
		} else {
			if (!nativePath.isAbsolute(target))
				target = nativePath.join(cwd, target);
		}
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
		for (let cmd of this.extraCommands) {
			cmds.push(this.sendCliCommand(cmd));
		}
		return cmds;
	}

	attach(cwd: string, executable: string, target: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			this.process = ChildProcess.spawn(this.application, this.preargs, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			const promises = this.initCommands(target, cwd, false, true);
			promises.push(this.sendCommand("file-exec-and-symbols \"" + escape(executable) + "\""));
			promises.push(this.sendCommand("target-attach " + target));
			Promise.all(promises).then(() => {
				this.emit("debug-ready");
				resolve(undefined);
			}, reject);
		});
	}

	setBreakPointCondition(bkptNum, condition): Thenable<any> {
		return this.sendCommand("break-condition " + bkptNum + " \"" + escape(condition) + "\" 1");
	}

	goto(filename: string, line: number): Thenable<Boolean> {
		return new Promise((resolve, reject) => {
			// LLDB parses the file differently than GDB...
			// GDB doesn't allow quoting only the file but only the whole argument
			// LLDB doesn't allow quoting the whole argument but rather only the file
			const target: string = (filename ? '"' + escape(filename) + '":' : "") + line;
			this.sendCliCommand("jump " + target).then(() => {
				this.emit("step-other", null);
				resolve(true);
			}, reject);
		});
	}
}
