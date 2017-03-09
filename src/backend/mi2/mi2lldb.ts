import { MI2 } from "./mi2"
import { escape } from "../mi_parse"
import { Breakpoint } from "../backend"
import * as ChildProcess from "child_process"
import { posix } from "path"
import * as nativePath from "path"
let path = posix;

export class MI2_LLDB extends MI2 {
	protected initCommands(target: string, cwd: string, autorunBeforeCmds: string[], ssh: boolean = false, attach: boolean = false) {
		let cmds = [];
		if (ssh) {
			if (!path.isAbsolute(target))
				target = path.join(cwd, target);
		}
		else {
			if (!nativePath.isAbsolute(target))
				target = nativePath.join(cwd, target);
		}
		autorunBeforeCmds.forEach(command => {
			cmds.push(this.sendCommand(command));
		});
		if (!attach)
			cmds.push(this.sendCommand("file-exec-and-symbols \"" + escape(target) + "\""));
		return cmds;
	}

	attach(cwd: string, executable: string, target: string, autorunBeforeCmds: string[]): Thenable<any> {
		return new Promise((resolve, reject) => {
			let cmds = [];
			this.process = ChildProcess.spawn(this.application, this.preargs, { cwd: cwd });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			autorunBeforeCmds.forEach(command => {
				cmds.push(this.sendCommand(command));
			});
			cmds.push(this.sendCommand("file-exec-and-symbols \"" + escape(executable) + "\""));
			Promise.all(cmds).then(() => {
				this.emit("debug-ready");
				resolve();
			}, reject);
		});
	}

	clearBreakPoints(): Thenable<any> {
		return new Promise((resolve, reject) => {
			let promises = [];
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
}