import { Breakpoint, IBackend, Thread, Stack, SSHArguments, Variable, RegisterValue, VariableObject, MIError } from "../backend";
import * as ChildProcess from "child_process";
import { EventEmitter } from "events";
import { parseMI, MINode } from '../mi_parse';
import * as linuxTerm from '../linux/console';
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { Client, ClientChannel, ExecOptions } from "ssh2";

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

class LogMessage {
	protected logMsgVar = "";
	protected logMsgVarProcess = "";
	protected logMsgRplNum = 0;
	protected logMsgRplItem: string[] = [];
	protected logMsgMatch = /(^\$[0-9]*[\ ]*=[\ ]*)(.*)/;
	protected logReplaceTest = /{([^}]*)}/g;
	public logMsgBrkList: Breakpoint[] = [];

	logMsgOutput(record:any){
		if ((record.type === 'console')) {
			if(record.content.startsWith("$")){
				const content = record.content;
				const variableMatch = this.logMsgMatch.exec(content);
				if (variableMatch) {
					const value = content.substr(variableMatch[1].length).trim();
					this.logMsgRplItem.push(value);
					this.logMsgRplNum--;
					if(this.logMsgRplNum == 0){
						for(let i = 0; i < this.logMsgRplItem.length; i++){
							this.logMsgVarProcess = this.logMsgVarProcess.replace("placeHolderForVariable", this.logMsgRplItem[i]);
						}
						return "Log Message:"  + this.logMsgVarProcess;
					}
				}
			}
			return undefined;
		}
	}

	logMsgProcess(parsed:MINode){
		this.logMsgBrkList.forEach((brk)=>{
			if(parsed.outOfBandRecord[0].output[0][1] == "breakpoint-hit" && parsed.outOfBandRecord[0].output[2][1] == brk.id){
				this.logMsgVar = brk?.logMessage;
				const matches = this.logMsgVar.match(this.logReplaceTest);
				const count = matches ? matches.length : 0;
				this.logMsgRplNum = count;
				this.logMsgVarProcess = this.logMsgVar.replace(this.logReplaceTest, "placeHolderForVariable");
				this.logMsgRplItem = [];
			}
		});
	}
}

export class MI2 extends EventEmitter implements IBackend {
	constructor(public application: string, public preargs: string[], public extraargs: string[], procEnv: any, public extraCommands: string[] = []) {
		super();

		if (procEnv) {
			const env: { [key: string]: string } = {};
			// Duplicate process.env so we don't override it
			for (const key in process.env)
				if (process.env.hasOwnProperty(key))
					env[key] = process.env[key];

			// Overwrite with user specified variables
			for (const key in procEnv) {
				if (procEnv.hasOwnProperty(key)) {
					if (procEnv === undefined)
						delete env[key];
					else
						env[key] = procEnv[key];
				}
			}
			this.procEnv = env;
		}
	}
	protected logMessage:LogMessage = new LogMessage;

	load(cwd: string, target: string, procArgs: string, separateConsole: string, autorun: string[]): Thenable<any> {
		if (!path.isAbsolute(target))
			target = path.join(cwd, target);
		return new Promise((resolve, reject) => {
			this.isSSH = false;
			const args = this.preargs.concat(this.extraargs || []);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", () => this.emit("quit"));
			this.process.on("error", err => this.emit("launcherror", err));
			const promises = this.initCommands(target, cwd);
			if (procArgs && procArgs.length)
				promises.push(this.sendCommand("exec-arguments " + procArgs));
			if (process.platform == "win32") {
				if (separateConsole !== undefined)
					promises.push(this.sendCommand("gdb-set new-console on"));
				promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
				Promise.all(promises).then(() => {
					this.emit("debug-ready");
					resolve(undefined);
				}, reject);
			} else {
				if (separateConsole !== undefined) {
					linuxTerm.spawnTerminalEmulator(separateConsole).then(tty => {
						promises.push(this.sendCommand("inferior-tty-set " + tty));
						promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
						Promise.all(promises).then(() => {
							this.emit("debug-ready");
							resolve(undefined);
						}, reject);
					});
				} else {
					promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
					Promise.all(promises).then(() => {
						this.emit("debug-ready");
						resolve(undefined);
					}, reject);
				}
			}
		});
	}

	ssh(args: SSHArguments, cwd: string, target: string, procArgs: string, separateConsole: string, attach: boolean, autorun: string[]): Thenable<any> {
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
				if (fs.existsSync(args.keyfile))
					connectionArgs.privateKey = fs.readFileSync(args.keyfile);
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
				const execArgs: ExecOptions = {};
				if (args.forwardX11) {
					execArgs.x11 = {
						single: false,
						screen: args.remotex11screen
					};
				}
				let sshCMD = this.application + " " + this.preargs.concat(this.extraargs || []).join(" ");
				if (args.bootstrap) sshCMD = args.bootstrap + " && " + sshCMD;
				this.sshConn.exec(sshCMD, execArgs, (err, stream) => {
					if (err) {
						this.log("stderr", "Could not run " + this.application + "(" + sshCMD + ") over ssh!");
						if (err === undefined) {
							err = new Error("<reason unknown>");
						}
						this.log("stderr", err.toString());
						this.emit("quit");
						reject();
						return;
					}
					this.sshReady = true;
					this.stream = stream;
					stream.on("data", this.stdout.bind(this));
					stream.stderr.on("data", this.stderr.bind(this));
					stream.on("exit", () => {
						this.emit("quit");
						this.sshConn.end();
					});
					const promises = this.initCommands(target, cwd, attach);
					promises.push(this.sendCommand("environment-cd \"" + escape(cwd) + "\""));
					if (attach) {
						// Attach to local process
						promises.push(this.sendCommand("target-attach " + target));
					} else if (procArgs && procArgs.length)
						promises.push(this.sendCommand("exec-arguments " + procArgs));
					promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
					Promise.all(promises).then(() => {
						this.emit("debug-ready");
						resolve(undefined);
					}, reject);
				});
			}).on("error", (err) => {
				this.log("stderr", "Error running " + this.application + " over ssh!");
				if (err === undefined) {
					err = new Error("<reason unknown>");
				}
				this.log("stderr", err.toString());
				this.emit("quit");
				reject();
			}).connect(connectionArgs);
		});
	}

	protected initCommands(target: string, cwd: string, attach: boolean = false) {
		// We need to account for the possibility of the path type used by the debugger being different
		// from the path type where the extension is running (e.g., SSH from Linux to Windows machine).
		// Since the CWD is expected to be an absolute path in the debugger's environment, we can test
		// that to determine the path type used by the debugger and use the result of that test to
		// select the correct API to check whether the target path is an absolute path.
		const debuggerPath = path.posix.isAbsolute(cwd) ? path.posix : path.win32;

		if (!debuggerPath.isAbsolute(target))
			target = debuggerPath.join(cwd, target);

		const cmds = [
			this.sendCommand("gdb-set target-async on", true),
			new Promise(resolve => {
				this.sendCommand("list-features").then(done => {
					this.features = done.result("features");
					resolve(undefined);
				}, () => {
					// Default to no supported features on error
					this.features = [];
					resolve(undefined);
				});
			}),
			this.sendCommand("environment-directory \"" + escape(cwd) + "\"", true)
		];
		if (!attach)
			cmds.push(this.sendCommand("file-exec-and-symbols \"" + escape(target) + "\""));
		if (this.prettyPrint)
			cmds.push(this.sendCommand("enable-pretty-printing"));
		if (this.frameFilters)
			cmds.push(this.sendCommand("enable-frame-filters"));
		for (const cmd of this.extraCommands) {
			cmds.push(this.sendCommand(cmd));
		}

		return cmds;
	}

	attach(cwd: string, executable: string, target: string, autorun: string[]): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = [];
			if (executable && !path.isAbsolute(executable))
				executable = path.join(cwd, executable);
			args = this.preargs.concat(this.extraargs || []);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", () => this.emit("quit"));
			this.process.on("error", err => this.emit("launcherror", err));
			const promises = this.initCommands(target, cwd, true);
			if (target.startsWith("extended-remote")) {
				promises.push(this.sendCommand("target-select " + target));
				if (executable)
					promises.push(this.sendCommand("file-symbol-file \"" + escape(executable) + "\""));
			} else {
				// Attach to local process
				if (executable)
					promises.push(this.sendCommand("file-exec-and-symbols \"" + escape(executable) + "\""));
				promises.push(this.sendCommand("target-attach " + target));
			}
			promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
			Promise.all(promises).then(() => {
				this.emit("debug-ready");
				resolve(undefined);
			}, reject);
		});
	}

	connect(cwd: string, executable: string, target: string, autorun: string[]): Thenable<any> {
		return new Promise((resolve, reject) => {
			let args = [];
			if (executable && !path.isAbsolute(executable))
				executable = path.join(cwd, executable);
			args = this.preargs.concat(this.extraargs || []);
			if (executable)
				args = args.concat([executable]);
			this.process = ChildProcess.spawn(this.application, args, { cwd: cwd, env: this.procEnv });
			this.process.stdout.on("data", this.stdout.bind(this));
			this.process.stderr.on("data", this.stderr.bind(this));
			this.process.on("exit", () => this.emit("quit"));
			this.process.on("error", err => this.emit("launcherror", err));
			const promises = this.initCommands(target, cwd, true);
			promises.push(this.sendCommand("target-select remote " + target));
			promises.push(...autorun.map(value => { return this.sendUserInput(value); }));
			Promise.all(promises).then(() => {
				this.emit("debug-ready");
				resolve(undefined);
			}, reject);
		});
	}

	stdout(data: any) {
		if (trace)
			this.log("stderr", "stdout: " + data);
		if (typeof data == "string")
			this.buffer += data;
		else
			this.buffer += data.toString("utf8");
		const end = this.buffer.lastIndexOf('\n');
		if (end != -1) {
			this.onOutput(this.buffer.substring(0, end));
			this.buffer = this.buffer.substring(end + 1);
		}
		if (this.buffer.length) {
			if (this.onOutputPartial(this.buffer)) {
				this.buffer = "";
			}
		}
	}

	stderr(data: any) {
		if (typeof data == "string")
			this.errbuf += data;
		else
			this.errbuf += data.toString("utf8");
		const end = this.errbuf.lastIndexOf('\n');
		if (end != -1) {
			this.onOutputStderr(this.errbuf.substring(0, end));
			this.errbuf = this.errbuf.substring(end + 1);
		}
		if (this.errbuf.length) {
			this.logNoNewLine("stderr", this.errbuf);
			this.errbuf = "";
		}
	}

	onOutputStderr(str: string) {
		const lines = str.split('\n');
		lines.forEach(line => {
			this.log("stderr", line);
		});
	}

	onOutputPartial(line: string) {
		if (couldBeOutput(line)) {
			this.logNoNewLine("stdout", line);
			return true;
		}
		return false;
	}

	onOutput(str: string) {
		const lines = str.split('\n');
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
							const logOutput = this.logMessage.logMsgOutput(record);
							if(logOutput){
								this.log("console", logOutput);
							}
						} else {
							if (record.type == "exec") {
								this.emit("exec-async-output", parsed);
								if (record.asyncClass == "running")
									this.emit("running", parsed);
								else if (record.asyncClass == "stopped") {
									const reason = parsed.record("reason");
									if (reason === undefined) {
										if (trace)
											this.log("stderr", "stop (no reason given)");
										// attaching to a process stops, but does not provide a reason
										// also python generated interrupt seems to only produce this
										this.emit("step-other", parsed);
									} else {
										if (trace)
											this.log("stderr", "stop: " + reason);
										switch (reason) {
											case "breakpoint-hit":
												this.emit("breakpoint", parsed);
												this.logMessage.logMsgProcess(parsed);
												break;
											case "watchpoint-trigger":
											case "read-watchpoint-trigger":
											case "access-watchpoint-trigger":
												this.emit("watchpoint", parsed);
												break;
											case "function-finished":
											// identical result → send step-end
											// this.emit("step-out-end", parsed);
											// break;
											case "location-reached":
											case "end-stepping-range":
												this.emit("step-end", parsed);
												break;
											case "watchpoint-scope":
											case "solib-event":
											case "syscall-entry":
											case "syscall-return":
												// TODO: inform the user
												this.emit("step-end", parsed);
												break;
											case "fork":
											case "vfork":
											case "exec":
												// TODO: inform the user, possibly add second inferior
												this.emit("step-end", parsed);
												break;
											case "signal-received":
												this.emit("signal-stop", parsed);
												break;
											case "exited-normally":
												this.emit("exited-normally", parsed);
												break;
											case "exited": // exit with error code != 0
												this.log("stderr", "Program exited with code " + parsed.record("exit-code"));
												this.emit("exited-normally", parsed);
												break;
												// case "exited-signalled":	// consider handling that explicit possible
												// 	this.log("stderr", "Program exited because of signal " + parsed.record("signal"));
												// 	this.emit("stopped", parsed);
												// 	break;

											default:
												this.log("console", "Not implemented stop reason (assuming exception): " + reason);
												this.emit("stopped", parsed);
												break;
										}
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

	start(runToStart: boolean): Thenable<boolean> {
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
		const promisses: Thenable<[boolean, Breakpoint]>[] = [];
		breakpoints.forEach(breakpoint => {
			promisses.push(this.addBreakPoint(breakpoint));
		});
		return Promise.all(promisses);
	}

	setBreakPointCondition(bkptNum: number, condition: string): Thenable<any> {
		if (trace)
			this.log("stderr", "setBreakPointCondition");
		return this.sendCommand("break-condition " + bkptNum + " " + condition);
	}

	setLogPoint(bkptNum:number, command:string): Thenable<any> {
		const regex = /{([a-z0-9A-Z-_\.\>\&\*\[\]]*)}/gm;
		let m:RegExpExecArray;
		let commands:string = "";

		while ((m = regex.exec(command))) {
			if (m.index === regex.lastIndex) {
				regex.lastIndex++;
			}
			if (m[1]) {
				commands += `\"print ${m[1]}\" `;
			}
		}
		return this.sendCommand("break-commands " + bkptNum + " " + commands);
	}

	setEntryBreakPoint(entryPoint: string): Thenable<any> {
		return this.sendCommand("break-insert -t -f " + entryPoint);
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
					location += "-i " + numRegex.exec(breakpoint.countCondition.substring(1))[0] + " ";
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
						id: bkptNum,
						file: breakpoint.file ? breakpoint.file : result.result("bkpt.file"),
						raw: breakpoint.raw,
						line: parseInt(result.result("bkpt.line")),
						condition: breakpoint.condition,
						logMessage: breakpoint?.logMessage,
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
					} else if (breakpoint.logMessage) {
						this.setLogPoint(bkptNum, breakpoint.logMessage).then((result) => {
							if (result.resultRecords.resultClass == "done") {
								breakpoint.id = newBrk.id;
								this.breakpoints.set(newBrk, bkptNum);
								this.logMessage.logMsgBrkList.push(breakpoint);
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

	clearBreakPoints(source?: string): Thenable<any> {
		if (trace)
			this.log("stderr", "clearBreakPoints");
		return new Promise((resolve, reject) => {
			const promises: Thenable<void | MINode>[] = [];
			const breakpoints = this.breakpoints;
			this.breakpoints = new Map();
			breakpoints.forEach((k, index) => {
				if (index.file === source) {
					promises.push(this.sendCommand("break-delete " + k).then((result) => {
						if (result.resultRecords.resultClass == "done") resolve(true);
						else resolve(false);
					}));
				} else {
					this.breakpoints.set(index, k);
				}
			});
			Promise.all(promises).then(resolve, reject);
		});
	}

	async getThreads(): Promise<Thread[]> {
		if (trace) this.log("stderr", "getThreads");

		const command = "thread-info";
		const result = await this.sendCommand(command);
		const threads = result.result("threads");
		const ret: Thread[] = [];
		if (!Array.isArray(threads)) { // workaround for lldb-mi bug: `'^done,threads="[]"'`
			return ret;
		}
		return threads.map(element => {
			const ret: Thread = {
				id: parseInt(MINode.valueOf(element, "id")),
				targetId: MINode.valueOf(element, "target-id"),
				name: MINode.valueOf(element, "name") || MINode.valueOf(element, "details")
			};

			return ret;
		});
	}

	async getStack(startFrame: number, maxLevels: number, thread: number): Promise<Stack[]> {
		if (trace) this.log("stderr", "getStack");

		const options: string[] = [];

		if (thread != 0)
			options.push("--thread " + thread);

		const depth: number = (await this.sendCommand(["stack-info-depth"].concat(options).join(" "))).result("depth").valueOf();
		const lowFrame: number = startFrame ? startFrame : 0;
		const highFrame: number = (maxLevels ? Math.min(depth, lowFrame + maxLevels) : depth) - 1;

		if (highFrame < lowFrame)
			return [];

		options.push(lowFrame.toString());
		options.push(highFrame.toString());

		const result = await this.sendCommand(["stack-list-frames"].concat(options).join(" "));
		const stack = result.result("stack");
		return stack.map((element: any) => {
			const level = MINode.valueOf(element, "@frame.level");
			const addr = MINode.valueOf(element, "@frame.addr");
			const func = MINode.valueOf(element, "@frame.func");
			const filename = MINode.valueOf(element, "@frame.file");
			let file: string = MINode.valueOf(element, "@frame.fullname");
			if (!file) {
				// Fallback to using `file` if `fullname` is not provided.
				// GDB does this for some reason when frame filters are used.
				file = MINode.valueOf(element, "@frame.file");
			}
			if (file) {
				if (this.isSSH)
					file = path.posix.normalize(file);
				else
					file = path.normalize(file);
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

	async getRegisters(): Promise<Variable[]> {
		if (trace)
			this.log("stderr", "getRegisters");

		// Getting register names and values are separate GDB commands.
		// We first retrieve the register names and then the values.
		// The register names should never change, so we could cache and reuse them,
		// but for now we just retrieve them every time to keep it simple.
		const names = await this.getRegisterNames();
		const values = await this.getRegisterValues();
		const ret: Variable[] = [];
		for (const val of values) {
			const key = names[val.index];
			const value = val.value;
			const type = "string";
			ret.push({
				name: key,
				valueStr: value,
				type: type
			});
		}
		return ret;
	}

	async getRegisterNames(): Promise<string[]> {
		if (trace)
			this.log("stderr", "getRegisterNames");
		const result = await this.sendCommand("data-list-register-names");
		const names = result.result('register-names');
		if (!Array.isArray(names)) {
			throw new Error('Failed to retrieve register names.');
		}
		return names.map(name => name.toString());
	}

	async getRegisterValues(): Promise<RegisterValue[]> {
		if (trace)
			this.log("stderr", "getRegisterValues");
		const result = await this.sendCommand("data-list-register-values --skip-unavailable N " + this.registerLimit);
		const nodes = result.result('register-values');
		if (!Array.isArray(nodes)) {
			throw new Error('Failed to retrieve register values.');
		}
		const ret: RegisterValue[] = nodes.map(node => {
			const index = parseInt(MINode.valueOf(node, "number"));
			const value = MINode.valueOf(node, "value");
			return { index: index, value: value };
		});
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

	async varCreate(threadId: number, frameLevel: number, expression: string, name: string = "-", frame: string = "@"): Promise<VariableObject> {
		if (trace)
			this.log("stderr", "varCreate");
		let miCommand = "var-create ";
		if (threadId != 0) {
			miCommand += `--thread ${threadId} --frame ${frameLevel}`;
		}
		const res = await this.sendCommand(`${miCommand} ${this.quote(name)} ${frame} "${expression}"`);
		return new VariableObject(res.result(""));
	}

	async varEvalExpression(name: string): Promise<MINode> {
		if (trace)
			this.log("stderr", "varEvalExpression");
		return this.sendCommand(`var-evaluate-expression ${this.quote(name)}`);
	}

	async varListChildren(name: string): Promise<VariableObject[]> {
		if (trace)
			this.log("stderr", "varListChildren");
		//TODO: add `from` and `to` arguments
		const res = await this.sendCommand(`var-list-children --all-values ${this.quote(name)}`);
		const children = res.result("children") || [];
		const omg: VariableObject[] = children.map((child: any) => new VariableObject(child[1]));
		return omg;
	}

	async varUpdate(name: string = "*"): Promise<MINode> {
		if (trace)
			this.log("stderr", "varUpdate");
		return this.sendCommand(`var-update --all-values ${this.quote(name)}`);
	}

	async varAssign(name: string, rawValue: string): Promise<MINode> {
		if (trace)
			this.log("stderr", "varAssign");
		return this.sendCommand(`var-assign ${this.quote(name)} ${rawValue}`);
	}

	logNoNewLine(type: string, msg: string) {
		this.emit("msg", type, msg);
	}

	log(type: string, msg: string) {
		this.emit("msg", type, msg[msg.length - 1] == '\n' ? msg : (msg + "\n"));
	}

	sendUserInput(command: string, threadId: number = 0, frameLevel: number = 0): Thenable<MINode> {
		if (command.startsWith("-")) {
			return this.sendCommand(command.substring(1));
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

	sendCliCommand(command: string, threadId: number = 0, frameLevel: number = 0): Thenable<MINode> {
		let miCommand = "interpreter-exec ";
		if (threadId != 0) {
			miCommand += `--thread ${threadId} --frame ${frameLevel} `;
		}
		miCommand += `console "${command.replace(/[\\"']/g, '\\$&')}"`;
		return this.sendCommand(miCommand);
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

	protected quote(text: string): string {
		// only escape if text contains non-word or non-path characters such as whitespace or quotes
		return /^-|[^\w\d\/_\-\.]/g.test(text) ? ('"' + escape(text) + '"') : text;
	}

	prettyPrint: boolean = true;
	frameFilters: boolean = true;
	printCalls: boolean;
	debugOutput: boolean;
	features: string[];
	public procEnv: any;
	public registerLimit: string;
	protected isSSH: boolean;
	protected sshReady: boolean;
	protected currentToken: number = 1;
	protected handlers: { [index: number]: (info: MINode) => any } = {};
	protected breakpoints: Map<Breakpoint, Number> = new Map();
	protected buffer: string;
	protected errbuf: string;
	protected process: ChildProcess.ChildProcess;
	protected stream: ClientChannel;
	protected sshConn: Client;
}
