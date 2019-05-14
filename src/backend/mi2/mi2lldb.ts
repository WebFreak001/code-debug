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
			this.sendCommand("gdb-set target-async on")
		];
		if (!attach)
			cmds.push(this.sendCommand("file-exec-and-symbols \"" + escape(target) + "\""));
		return cmds;
	}

	attach(cwd: string, executable: string, target: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			this.process = ChildProcess.spawn(this.application, this.preargs, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			Promise.all([
				this.sendCommand("gdb-set target-async on"),
				this.sendCommand("file-exec-and-symbols \"" + escape(executable) + "\""),
				this.sendCommand("target-attach " + target)
			]).then(() => {
				this.emit("debug-ready");
				resolve();
			}, reject);
		});
	}

	clearBreakPoints(): Thenable<any> {
		return new Promise((resolve, reject) => {
			const promises = [];
			this.breakpoints.forEach((k, index) => {
				promises.push(this.sendCommand("break-delete " + k).then((result) => {
					if (result.resultRecords.resultClass == "done") resolve(true);
					else resolve(false);
				}));
			});
			this.breakpoints.clear();
			Promise.all(promises).then(resolve, reject);
		});
	}

	setBreakPointCondition(bkptNum, condition): Thenable<any> {
		return this.sendCommand("break-condition " + bkptNum + " \"" + escape(condition) + "\" 1");
	}

	goto(filename: string, line: number): Thenable<Boolean> {
		return new Promise((resolve, reject) => {
			const target: string = (filename ? filename + ":" : "") + line;
			this.sendCliCommand("jump " + target).then(() => {
				resolve(true);
			}, reject);
		});
	}
}
