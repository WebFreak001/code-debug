import { Breakpoint, IBackend, Thread, Stack, SSHArguments, Variable, VariableObject, MIError } from "../backend";
import * as ChildProcess from "child_process";
import { EventEmitter } from "events";
import { parseMI, MINode } from '../mi_parse';
import * as linuxTerm from '../linux/console';
import * as net from "net";
import * as fs from "fs";
import { posix } from "path";
import * as nativePath from "path";
const path = posix;
import { Client } from "ssh2";

export function escape(str: string) {
	return str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

const nonOutput = /^(?:\d*|undefined)[\*\+\=]|[\~\@\&\^]/;
const gdbMatch = /(?:\d*|undefined)\(gdb\)/;
const numRegex = /\d+/;

function couldBeOutput(line: string) {
	if (nonOutput.exec(line))
		return false;
	return true;
}

const trace = false;

export class MI2 extends EventEmitter implements IBackend {
	constructor(public application: string, public preargs: string[], public extraargs: string[], procEnv: any) {
		super();

		if (procEnv) {
			const env = {};
			// Duplicate process.env so we don't override it
			for (const key in process.env)
				if (process.env.hasOwnProperty(key))
					env[key] = process.env[key];

			// Overwrite with user specified variables
			for (const key in procEnv) {
				if (procEnv.hasOwnProperty(key)) {
					if (procEnv === null)
						delete env[key];
					else
						env[key] = procEnv[key];
				}
			}
			this.procEnv = env;
		}
	}

	load(cwd: string, target: string, procArgs: string, separateConsole: string): Thenable<any> {
		if (!nativePath.isAbsolute(target))
			target = nativePath.join(cwd, target);
		return new Promise((resolve, reject) => {
			this.isSSH = false;
			const args = this.preargs.concat(this.extraargs || []);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			const promises = this.initCommands(target, cwd);
			if (procArgs && procArgs.length)
				promises.push(this.sendCommand("exec-arguments " + procArgs));
			if (process.platform == "win32") {
				if (separateConsole !== undefined)
					promises.push(this.sendCommand("gdb-set new-console on"));
				Promise.all(promises).then(() => {
					this.emit("debug-ready");
					resolve();
				}, reject);
			} else {
				if (separateConsole !== undefined) {
					linuxTerm.spawnTerminalEmulator(separateConsole).then(tty => {
						promises.push(this.sendCommand("inferior-tty-set " + tty));
						Promise.all(promises).then(() => {
							this.emit("debug-ready");
							resolve();
						}, reject);
					});
				} else {
					Promise.all(promises).then(() => {
						this.emit("debug-ready");
						resolve();
					}, reject);
				}
			}
		});
	}

	ssh(args: SSHArguments, cwd: string, target: string, procArgs: string, separateConsole: string, attach: boolean): Thenable<any> {
		return new Promise((resolve, reject) => {
			this.isSSH = true;
			this.sshReady = false;
			this.sshConn = new Client();

			if (separateConsole !== undefined)
				this.log("stderr", "WARNING: Output to terminal emulators are not supported over SSH");

			if (args.forwardX11) {
				this.sshConn.on("x11", (info, accept, reject) => {
					const xserversock = new net.Socket();
					xserversock.on("error", (err) => {
						this.log("stderr", "Could not connect to local X11 server! Did you enable it in your display manager?\n" + err);
					});
					xserversock.on("connect", () => {
						const xclientsock = accept();
						xclientsock.pipe(xserversock).pipe(xclientsock);
					});
					xserversock.connect(args.x11port, args.x11host);
				});
			}

			const connectionArgs: any = {
				host: args.host,
				port: args.port,
				username: args.user
			};

			if (args.useAgent) {
				connectionArgs.agent = process.env.SSH_AUTH_SOCK;
			} else if (args.keyfile) {
				if (require("fs").existsSync(args.keyfile))
					connectionArgs.privateKey = require("fs").readFileSync(args.keyfile);
				else {
					this.log("stderr", "SSH key file does not exist!");
					this.emit("quit");
					reject();
					return;
				}
			} else {
				connectionArgs.password = args.password;
			}

			this.sshConn.on("ready", () => {
				this.log("stdout", "Running " + this.application + " over ssh...");
				const execArgs: any = {};
				if (args.forwardX11) {
					execArgs.x11 = {
						single: false,
						screen: args.remotex11screen
					};
				}
				let sshCMD = this.application + " " + this.preargs.join(" ");
				if (args.bootstrap) sshCMD = args.bootstrap + " && " + sshCMD;
				if (attach)
					sshCMD += " -p " + target;
				this.sshConn.exec(sshCMD, execArgs, (err, stream) => {
					if (err) {
						this.log("stderr", "Could not run " + this.application + " over ssh!");
						this.log("stderr", err.toString());
						this.emit("quit");
						reject();
						return;
					}
					this.sshReady = true;
					this.stream = stream;
					stream.on("data", this.stdout.bind(this));
					stream.stderr.on("data", this.stderr.bind(this));
					stream.on("exit", (() => {
						this.emit("quit");
						this.sshConn.end();
					}).bind(this));
					const promises = this.initCommands(target, cwd, true, attach);
					promises.push(this.sendCommand("environment-cd \"" + escape(cwd) + "\""));
					if (procArgs && procArgs.length && !attach)
						promises.push(this.sendCommand("exec-arguments " + procArgs));
					Promise.all(promises).then(() => {
						this.emit("debug-ready");
						resolve();
					}, reject);
				});
			}).on("error", (err) => {
				this.log("stderr", "Could not run " + this.application + " over ssh!");
				this.log("stderr", err.toString());
				this.emit("quit");
				reject();
			}).connect(connectionArgs);
		});
	}

	protected initCommands(target: string, cwd: string, ssh: boolean = false, attach: boolean = false) {
		if (ssh) {
			if (!path.isAbsolute(target))
				target = path.join(cwd, target);
		} else {
			if (!nativePath.isAbsolute(target))
				target = nativePath.join(cwd, target);
		}
		const cmds = [
			this.sendCommand("gdb-set target-async on", true),
			this.sendCommand("environment-directory \"" + escape(cwd) + "\"", true)
		];
		if (!attach)
			cmds.push(this.sendCommand("file-exec-and-symbols \"" + escape(target) + "\""));
		if (this.prettyPrint)
			cmds.push(this.sendCommand("enable-pretty-printing"));

		return cmds;
	}

	attach(cwd: string, executable: string, target: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = [];
			if (executable && !nativePath.isAbsolute(executable))
				executable = nativePath.join(cwd, executable);
			if (!executable)
				executable = "-p";
			let isExtendedRemote = false;
			if (target.startsWith("extended-remote")) {
				isExtendedRemote = true;
				args = this.preargs;
			} else
				args = args.concat([executable, target], this.preargs);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			const commands = [
				this.sendCommand("gdb-set target-async on"),
				this.sendCommand("environment-directory \"" + escape(cwd) + "\"")
			];
			if (isExtendedRemote) {
				commands.push(this.sendCommand("target-select " + target));
				commands.push(this.sendCommand("file-symbol-file \"" + escape(executable) + "\""));
			}
			Promise.all(commands).then(() => {
				this.emit("debug-ready");
				resolve();
			}, reject);
		});
	}

	connect(cwd: string, executable: string, target: string): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = [];
			if (executable && !nativePath.isAbsolute(executable))
				executable = nativePath.join(cwd, executable);
			if (executable)
				args = args.concat([executable], this.preargs);
			else
				args = this.preargs;
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", (() => { this.emit("quit"); }).bind(this));
			this.process.on("error", ((err) => { this.emit("launcherror", err); }).bind(this));
			Promise.all([
				this.sendCommand("gdb-set target-async on"),
				this.sendCommand("environment-directory \"" + escape(cwd) + "\""),
				this.sendCommand("target-select remote " + target)
			]).then(() => {
				this.emit("debug-ready");
				resolve();
			}, reject);
		});
	}

	stdout(data) {
		if (trace)
			this.log("stderr", "stdout: " + data);
		if (typeof data == "string")
			this.buffer += data;
		else
			this.buffer += data.toString("utf8");
		const end = this.buffer.lastIndexOf('\n');
		if (end != -1) {
			this.onOutput(this.buffer.substr(0, end));
			this.buffer = this.buffer.substr(end + 1);
		}
		if (this.buffer.length) {
			if (this.onOutputPartial(this.buffer)) {
				this.buffer = "";
			}
		}
	}

	stderr(data) {
		if (typeof data == "string")
			this.errbuf += data;
		else
			this.errbuf += data.toString("utf8");
		const end = this.errbuf.lastIndexOf('\n');
		if (end != -1) {
			this.onOutputStderr(this.errbuf.substr(0, end));
			this.errbuf = this.errbuf.substr(end + 1);
		}
		if (this.errbuf.length) {
			this.logNoNewLine("stderr", this.errbuf);
			this.errbuf = "";
		}
	}

	onOutputStderr(lines) {
		lines = <string[]> lines.split('\n');
		lines.forEach(line => {
			this.log("stderr", line);
		});
	}

	onOutputPartial(line) {
		if (couldBeOutput(line)) {
			this.logNoNewLine("stdout", line);
			return true;
		}
		return false;
	}

	onOutput(lines) {
		lines = <string[]> lines.split('\n');
		lines.forEach(line => {
			if (couldBeOutput(line)) {
				if (!gdbMatch.exec(line))
					this.log("stdout", line);
			} else {
				const parsed = parseMI(line);
				if (this.debugOutput)
					this.log("log", "GDB -> App: " + JSON.stringify(parsed));
				let handled = false;
				if (parsed.token !== undefined) {
					if (this.handlers[parsed.token]) {
						this.handlers[parsed.token](parsed);
						delete this.handlers[parsed.token];
						handled = true;
					}
				}
				if (!handled && parsed.resultRecords && parsed.resultRecords.resultClass == "error") {
					this.log("stderr", parsed.result("msg") || line);
				}
				if (parsed.outOfBandRecord) {
					parsed.outOfBandRecord.forEach(record => {
						if (record.isStream) {
							this.log(record.type, record.content);
						} else {
							if (record.type == "exec") {
								this.emit("exec-async-output", parsed);
								if (record.asyncClass == "running")
									this.emit("running", parsed);
								else if (record.asyncClass == "stopped") {
									const reason = parsed.record("reason");
									if (trace)
										this.log("stderr", "stop: " + reason);
									if (reason == "breakpoint-hit")
										this.emit("breakpoint", parsed);
									else if (reason == "end-stepping-range")
										this.emit("step-end", parsed);
									else if (reason == "function-finished")
										this.emit("step-out-end", parsed);
									else if (reason == "signal-received")
										this.emit("signal-stop", parsed);
									else if (reason == "exited-normally")
										this.emit("exited-normally", parsed);
									else if (reason == "exited") { // exit with error code != 0
										this.log("stderr", "Program exited with code " + parsed.record("exit-code"));
										this.emit("exited-normally", parsed);
									} else {
										this.log("console", "Not implemented stop reason (assuming exception): " + reason);
										this.emit("stopped", parsed);
									}
								} else
									this.log("log", JSON.stringify(parsed));
							} else if (record.type == "notify") {
								if (record.asyncClass == "thread-created") {
									this.emit("thread-created", parsed);
								} else if (record.asyncClass == "thread-exited") {
									this.emit("thread-exited", parsed);
								}
							}
						}
					});
					handled = true;
				}
				if (parsed.token == undefined && parsed.resultRecords == undefined && parsed.outOfBandRecord.length == 0)
					handled = true;
				if (!handled)
					this.log("log", "Unhandled: " + JSON.stringify(parsed));
			}
		});
	}

	start(): Thenable<boolean> {
		return new Promise((resolve, reject) => {
			this.once("ui-break-done", () => {
				this.log("console", "Running executable");
				this.sendCommand("exec-run").then((info) => {
					if (info.resultRecords.resultClass == "running")
						resolve();
					else
						reject();
				}, reject);
			});
		});
	}

	stop() {
		if (this.isSSH) {
			const proc = this.stream;
			const to = setTimeout(() => {
				proc.signal("KILL");
			}, 1000);
			this.stream.on("exit", function (code) {
				clearTimeout(to);
			});
			this.sendRaw("-gdb-exit");
		} else {
			const proc = this.process;
			const to = setTimeout(() => {
				process.kill(-proc.pid);
			}, 1000);
			this.process.on("exit", function (code) {
				clearTimeout(to);
			});
			this.sendRaw("-gdb-exit");
		}
	}

	detach() {
		const proc = this.process;
		const to = setTimeout(() => {
			process.kill(-proc.pid);
		}, 1000);
		this.process.on("exit", function (code) {
			clearTimeout(to);
		});
		this.sendRaw("-target-detach");
	}

	interrupt(): Thenable<boolean> {
		if (trace)
			this.log("stderr", "interrupt");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-interrupt").then((info) => {
				resolve(info.resultRecords.resultClass == "done");
			}, reject);
		});
	}

	continue(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "continue");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-continue" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	next(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "next");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-next" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	step(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "step");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-step" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	stepOut(reverse: boolean = false): Thenable<boolean> {
		if (trace)
			this.log("stderr", "stepOut");
		return new Promise((resolve, reject) => {
			this.sendCommand("exec-finish" + (reverse ? " --reverse" : "")).then((info) => {
				resolve(info.resultRecords.resultClass == "running");
			}, reject);
		});
	}

	goto(filename: string, line: number): Thenable<Boolean> {
		if (trace)
			this.log("stderr", "goto");
		return new Promise((resolve, reject) => {
			const target: string = '"' + (filename ? escape(filename) + ":" : "") + line + '"';
			this.sendCommand("break-insert -t " + target).then(() => {
				this.sendCommand("exec-jump " + target).then((info) => {
					resolve(info.resultRecords.resultClass == "running");
				}, reject);
			}, reject);
		});
	}

	changeVariable(name: string, rawValue: string): Thenable<any> {
		if (trace)
			this.log("stderr", "changeVariable");
		return this.sendCommand("gdb-set var " + name + "=" + rawValue);
	}

	loadBreakPoints(breakpoints: Breakpoint[]): Thenable<[boolean, Breakpoint][]> {
		if (trace)
			this.log("stderr", "loadBreakPoints");
		const promisses = [];
		breakpoints.forEach(breakpoint => {
			promisses.push(this.addBreakPoint(breakpoint));
		});
		return Promise.all(promisses);
	}

	setBreakPointCondition(bkptNum, condition): Thenable<any> {
		if (trace)
			this.log("stderr", "setBreakPointCondition");
		return this.sendCommand("break-condition " + bkptNum + " " + condition);
	}

	addBreakPoint(breakpoint: Breakpoint): Thenable<[boolean, Breakpoint]> {
		if (trace)
			this.log("stderr", "addBreakPoint");
		return new Promise((resolve, reject) => {
			if (this.breakpoints.has(breakpoint))
				return resolve([false, undefined]);
			let location = "";
			if (breakpoint.countCondition) {
				if (breakpoint.countCondition[0] == ">")
					location += "-i " + numRegex.exec(breakpoint.countCondition.substr(1))[0] + " ";
				else {
					const match = numRegex.exec(breakpoint.countCondition)[0];
					if (match.length != breakpoint.countCondition.length) {
						this.log("stderr", "Unsupported break count expression: '" + breakpoint.countCondition + "'. Only supports 'X' for breaking once after X times or '>X' for ignoring the first X breaks");
						location += "-t ";
					} else if (parseInt(match) != 0)
						location += "-t -i " + parseInt(match) + " ";
				}
			}
			if (breakpoint.raw)
				location += '"' + escape(breakpoint.raw) + '"';
			else
				location += '"' + escape(breakpoint.file) + ":" + breakpoint.line + '"';
			this.sendCommand("break-insert -f " + location).then((result) => {
				if (result.resultRecords.resultClass == "done") {
					const bkptNum = parseInt(result.result("bkpt.number"));
					const newBrk = {
						file: result.result("bkpt.file"),
						line: parseInt(result.result("bkpt.line")),
						condition: breakpoint.condition
					};
					if (breakpoint.condition) {
						this.setBreakPointCondition(bkptNum, breakpoint.condition).then((result) => {
							if (result.resultRecords.resultClass == "done") {
								this.breakpoints.set(newBrk, bkptNum);
								resolve([true, newBrk]);
							} else {
								resolve([false, undefined]);
							}
						}, reject);
					} else {
						this.breakpoints.set(newBrk, bkptNum);
						resolve([true, newBrk]);
					}
				} else {
					reject(result);
				}
			}, reject);
		});
	}

	removeBreakPoint(breakpoint: Breakpoint): Thenable<boolean> {
		if (trace)
			this.log("stderr", "removeBreakPoint");
		return new Promise((resolve, reject) => {
			if (!this.breakpoints.has(breakpoint))
				return resolve(false);
			this.sendCommand("break-delete " + this.breakpoints.get(breakpoint)).then((result) => {
				if (result.resultRecords.resultClass == "done") {
					this.breakpoints.delete(breakpoint);
					resolve(true);
				} else resolve(false);
			});
		});
	}

	clearBreakPoints(): Thenable<any> {
		if (trace)
			this.log("stderr", "clearBreakPoints");
		return new Promise((resolve, reject) => {
			this.sendCommand("break-delete").then((result) => {
				if (result.resultRecords.resultClass == "done") {
					this.breakpoints.clear();
					resolve(true);
				} else resolve(false);
			}, () => {
				resolve(false);
			});
		});
	}

	async getThreads(): Promise<Thread[]> {
		if (trace) this.log("stderr", "getThreads");

		const command = "thread-info";
		const result = await this.sendCommand(command);
		const threads = result.result("threads");
		const ret: Thread[] = [];
		return threads.map(element => {
			const ret: Thread = {
				id: parseInt(MINode.valueOf(element, "id")),
				targetId: MINode.valueOf(element, "target-id")
			};

			const name = MINode.valueOf(element, "name");
			if (name) {
				ret.name = name;
			}

			return ret;
		});
	}

	async getStack(maxLevels: number, thread: number): Promise<Stack[]> {
		if (trace) this.log("stderr", "getStack");

		let command = "stack-list-frames";
		if (thread != 0) {
			command += ` --thread ${thread}`;
		}
		if (maxLevels) {
			command += " 0 " + maxLevels;
		}
		const result = await this.sendCommand(command);
		const stack = result.result("stack");
		const ret: Stack[] = [];
		return stack.map(element => {
			const level = MINode.valueOf(element, "@frame.level");
			const addr = MINode.valueOf(element, "@frame.addr");
			const func = MINode.valueOf(element, "@frame.func");
			const filename = MINode.valueOf(element, "@frame.file");
			let file: string = MINode.valueOf(element, "@frame.fullname");
			if (file) {
				if (this.isSSH)
					file = posix.normalize(file);
				else
					file = nativePath.normalize(file);
			}

			let line = 0;
			const lnstr = MINode.valueOf(element, "@frame.line");
			if (lnstr)
				line = parseInt(lnstr);
			const from = parseInt(MINode.valueOf(element, "@frame.from"));
			return {
				address: addr,
				fileName: filename,
				file: file,
				function: func || from,
				level: level,
				line: line
			};
		});
	}

	async getStackVariables(thread: number, frame: number): Promise<Variable[]> {
		if (trace)
			this.log("stderr", "getStackVariables");

		const result = await this.sendCommand(`stack-list-variables --thread ${thread} --frame ${frame} --simple-values`);
		const variables = result.result("variables");
		const ret: Variable[] = [];
		for (const element of variables) {
			const key = MINode.valueOf(element, "name");
			const value = MINode.valueOf(element, "value");
			const type = MINode.valueOf(element, "type");
			ret.push({
				name: key,
				valueStr: value,
				type: type,
				raw: element
			});
		}
		return ret;
	}

	examineMemory(from: number, length: number): Thenable<any> {
		if (trace)
			this.log("stderr", "examineMemory");
		return new Promise((resolve, reject) => {
			this.sendCommand("data-read-memory-bytes 0x" + from.toString(16) + " " + length).then((result) => {
				resolve(result.result("memory[0].contents"));
			}, reject);
		});
	}

	async evalExpression(name: string, thread: number, frame: number): Promise<MINode> {
		if (trace)
			this.log("stderr", "evalExpression");

		let command = "data-evaluate-expression ";
		if (thread != 0) {
			command += `--thread ${thread} --frame ${frame} `;
		}
		command += name;

		return await this.sendCommand(command);
	}

	async varCreate(expression: string, name: string = "-"): Promise<VariableObject> {
		if (trace)
			this.log("stderr", "varCreate");
		const res = await this.sendCommand(`var-create ${name} @ "${expression}"`);
		return new VariableObject(res.result(""));
	}

	async varEvalExpression(name: string): Promise<MINode> {
		if (trace)
			this.log("stderr", "varEvalExpression");
		return this.sendCommand(`var-evaluate-expression ${name}`);
	}

	async varListChildren(name: string): Promise<VariableObject[]> {
		if (trace)
			this.log("stderr", "varListChildren");
		//TODO: add `from` and `to` arguments
		const res = await this.sendCommand(`var-list-children --all-values ${name}`);
		const children = res.result("children") || [];
		const omg: VariableObject[] = children.map(child => new VariableObject(child[1]));
		return omg;
	}

	async varUpdate(name: string = "*"): Promise<MINode> {
		if (trace)
			this.log("stderr", "varUpdate");
		return this.sendCommand(`var-update --all-values ${name}`);
	}

	async varAssign(name: string, rawValue: string): Promise<MINode> {
		if (trace)
			this.log("stderr", "varAssign");
		return this.sendCommand(`var-assign ${name} ${rawValue}`);
	}

	logNoNewLine(type: string, msg: string) {
		this.emit("msg", type, msg);
	}

	log(type: string, msg: string) {
		this.emit("msg", type, msg[msg.length - 1] == '\n' ? msg : (msg + "\n"));
	}

	sendUserInput(command: string, threadId: number = 0, frameLevel: number = 0): Thenable<any> {
		if (command.startsWith("-")) {
			return this.sendCommand(command.substr(1));
		} else {
			return this.sendCliCommand(command, threadId, frameLevel);
		}
	}

	sendRaw(raw: string) {
		if (this.printCalls)
			this.log("log", raw);
		if (this.isSSH)
			this.stream.write(raw + "\n");
		else
			this.process.stdin.write(raw + "\n");
	}

	async sendCliCommand(command: string, threadId: number = 0, frameLevel: number = 0) {
		let miCommand = "interpreter-exec ";
		if (threadId != 0) {
			miCommand += `--thread ${threadId} --frame ${frameLevel} `;
		}
		miCommand += `console "${command.replace(/[\\"']/g, '\\$&')}"`;
		await this.sendCommand(miCommand);
	}

	sendCommand(command: string, suppressFailure: boolean = false): Thenable<MINode> {
		const sel = this.currentToken++;
		return new Promise((resolve, reject) => {
			this.handlers[sel] = (node: MINode) => {
				if (node && node.resultRecords && node.resultRecords.resultClass === "error") {
					if (suppressFailure) {
						this.log("stderr", `WARNING: Error executing command '${command}'`);
						resolve(node);
					} else
						reject(new MIError(node.result("msg") || "Internal error", command));
				} else
					resolve(node);
			};
			this.sendRaw(sel + "-" + command);
		});
	}

	isReady(): boolean {
		return this.isSSH ? this.sshReady : !!this.process;
	}

	prettyPrint: boolean = true;
	printCalls: boolean;
	debugOutput: boolean;
	public procEnv: any;
	protected isSSH: boolean;
	protected sshReady: boolean;
	protected currentToken: number = 1;
	protected handlers: { [index: number]: (info: MINode) => any } = {};
	protected breakpoints: Map<Breakpoint, Number> = new Map();
	protected buffer: string;
	protected errbuf: string;
	protected process: ChildProcess.ChildProcess;
	protected stream;
	protected sshConn;
}
