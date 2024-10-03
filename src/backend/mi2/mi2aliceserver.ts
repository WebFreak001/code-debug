// Directly manages an Aliceserver instance by managing MI requests.

import { MI2, escape } from "./mi2";
import { Breakpoint } from "../backend";
import * as ChildProcess from "child_process";
import * as path from "path";
import { MINode } from "../mi_parse";

export class MI2_ALICE extends MI2 {
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
			// Aliceserver is already async by default
			//this.sendCommand("gdb-set target-async on"),

			/* Format unknown since I'm too lazy to compile lldb-mi
			new Promise(resolve => {
				this.sendCommand("list-features").then(done => {
					this.features = done.result("features");
					resolve(undefined);
				}, err => {
					this.features = [];
					resolve(undefined);
				});
			}) as Thenable<MINode>,
			*/

			// TODO: environment-directory
			// Command not currently supported
			//this.sendCommand("environment-directory \"" + escape(cwd) + "\"", true)
		] as Thenable<MINode>[];
		if (!attach) // When launching
			cmds.push(this.sendCommand("file-exec-and-symbols \"" + escape(target) + "\""));
		for (const cmd of this.extraCommands) // For the target process
			cmds.push(this.sendCliCommand(cmd));
		return cmds;
	}

	// Start debugging target
	override start(runToStart: boolean): Thenable<boolean> {
		const options: string[] = [];
		if (runToStart)
			options.push("--start");
		const startCommand: string = ["exec-run"].concat(options).join(" ");
		return new Promise((resolve, reject) => {
			this.log("console", "Running executable");
			this.sendCommand(startCommand).then((info) => {
				if (info.resultRecords.resultClass == "running")
					resolve(undefined);
				else
					reject();
			}, reject);
		});
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
			promises.push(this.sendCommand("attach " + target));
			promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
			Promise.all(promises).then(() => {
				this.emit("debug-ready");
				resolve(undefined);
			}, reject);
		});
	}

	override stop(): void {
		this.sendRaw("-gdb-exit");
		if (this.isSSH) {
			const proc = this.stream;
			const to = setTimeout(() => {
				proc.signal("KILL");
			}, 1000);
			this.stream.on("exit", function (code) {
				clearTimeout(to);
			});
		} else {
			const proc = this.process;
			const to = setTimeout(() => {
				// When tinkering with Aliceserver:
				// - the proc.pid field might be undefined (when exited too early)
				// - the process could no longer be found after sending requests (crashed or exited)
				try
				{
					process.kill(-proc.pid);
				}
				catch (error)
				{
					// Warning, since it does not prevent the intent of
					// continuing to shut down the server.
					console.warn("Failed to terminate process: " + error);
				}
			}, 1000);
			this.process.on("exit", function (code) {
				clearTimeout(to);
			});
		}
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
