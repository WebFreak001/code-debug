import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Breakpoint, IBackend, Variable, VariableObject, ValuesFormattingMode, MIError } from './backend/backend';
import { MINode } from './backend/mi_parse';
import { expandValue, isExpandable } from './backend/gdb_expansion';
import { MI2 } from './backend/mi2/mi2';
import { posix } from "path";
import * as systemPath from "path";
import * as net from "net";
import * as os from "os";
import * as fs from "fs";

let resolve = posix.resolve;
let relative = posix.relative;

class ExtendedVariable {
	constructor(public name, public options) {
	}
}

const STACK_HANDLES_START = 1000;
const VAR_HANDLES_START = 2000;

export class MI2DebugSession extends DebugSession {
	protected variableHandles = new Handles<string | VariableObject | ExtendedVariable>(VAR_HANDLES_START);
	protected variableHandlesReverse: { [id: string]: number } = {};
	protected useVarObjects: boolean;
	protected quit: boolean;
	protected attached: boolean;
	protected needContinue: boolean;
	protected isSSH: boolean;
	protected trimCWD: string;
	protected switchCWD: string;
	protected relative: boolean;
	protected started: boolean;
	protected crashed: boolean;
	protected debugReady: boolean;
	protected miDebugger: MI2;
	protected threadID: number = 1;
	protected commandServer: net.Server;

	public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false, threadID: number = 1) {
		super(debuggerLinesStartAt1, isServer);
		this.threadID = threadID;
	}

	protected initDebugger() {
		this.miDebugger.on("launcherror", this.launchError.bind(this));
		this.miDebugger.on("quit", this.quitEvent.bind(this));
		this.miDebugger.on("exited-normally", this.quitEvent.bind(this));
		this.miDebugger.on("stopped", this.stopEvent.bind(this));
		this.miDebugger.on("msg", this.handleMsg.bind(this));
		this.miDebugger.on("breakpoint", this.handleBreakpoint.bind(this));
		this.miDebugger.on("step-end", this.handleBreak.bind(this));
		this.miDebugger.on("step-out-end", this.handleBreak.bind(this));
		this.miDebugger.on("signal-stop", this.handlePause.bind(this));
		this.sendEvent(new InitializedEvent());
		try {
			this.commandServer = net.createServer(c => {
				c.on("data", data => {
					var rawCmd = data.toString();
					var spaceIndex = rawCmd.indexOf(" ");
					var func = rawCmd;
					var args = [];
					if (spaceIndex != -1) {
						func = rawCmd.substr(0, spaceIndex);
						args = JSON.parse(rawCmd.substr(spaceIndex + 1));
					}
					Promise.resolve(this.miDebugger[func].apply(this.miDebugger, args)).then(data => {
						c.write(data.toString());
					});
				});
			});
			this.commandServer.on("error", err => {
				if (process.platform != "win32")
					this.handleMsg("stderr", "Code-Debug WARNING: Utility Command Server: Error in command socket " + err.toString() + "\nCode-Debug WARNING: The examine memory location command won't work");
			});
			if (!fs.existsSync(systemPath.join(os.tmpdir(), "code-debug-sockets")))
				fs.mkdirSync(systemPath.join(os.tmpdir(), "code-debug-sockets"));
			this.commandServer.listen(systemPath.join(os.tmpdir(), "code-debug-sockets", "Debug-Instance-" + Math.floor(Math.random() * 36 * 36 * 36 * 36).toString(36)));
		} catch (e) {
			if (process.platform != "win32")
				this.handleMsg("stderr", "Code-Debug WARNING: Utility Command Server: Failed to start " + e.toString() + "\nCode-Debug WARNING: The examine memory location command won't work");
		}
	}

	protected setValuesFormattingMode(mode: ValuesFormattingMode) {
		switch (mode) {
			case "disabled":
				this.useVarObjects = true;
				this.miDebugger.prettyPrint = false;
				break;
			case "prettyPrinters":
				this.useVarObjects = true;
				this.miDebugger.prettyPrint = true;
				break;
			case "parseText":
			default:
				this.useVarObjects = false;
				this.miDebugger.prettyPrint = false;
		}
	}

	protected handleMsg(type: string, msg: string) {
		if (type == "target")
			type = "stdout";
		if (type == "log")
			type = "stderr";
		this.sendEvent(new OutputEvent(msg, type));
	}

	protected handleBreakpoint(info: MINode) {
		this.sendEvent(new StoppedEvent("breakpoint", this.threadID));
	}

	protected handleBreak(info: MINode) {
		this.sendEvent(new StoppedEvent("step", this.threadID));
	}

	protected handlePause(info: MINode) {
		this.sendEvent(new StoppedEvent("user request", this.threadID));
	}

	protected stopEvent(info: MINode) {
		if (!this.started)
			this.crashed = true;
		if (!this.quit)
			this.sendEvent(new StoppedEvent("exception", this.threadID));
	}

	protected quitEvent() {
		this.quit = true;
		this.sendEvent(new TerminatedEvent());
	}

	protected launchError(err: any) {
		this.handleMsg("stderr", "Could not start debugger process, does the program exist in filesystem?\n");
		this.handleMsg("stderr", err.toString() + "\n");
		this.quitEvent();
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		if (this.attached)
			this.miDebugger.detach();
		else
			this.miDebugger.stop();
		this.commandServer.close();
		this.commandServer = undefined;
		this.sendResponse(response);
	}

	protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
		try {
			if (this.useVarObjects) {
				let name = args.name;
				if (args.variablesReference >= VAR_HANDLES_START) {
					const parent = this.variableHandles.get(args.variablesReference) as VariableObject;
					name = `${parent.name}.${name}`;
				}

				let res = await this.miDebugger.varAssign(name, args.value);
				response.body = {
					value: res.result("value")
				};
			}
			else {
				await this.miDebugger.changeVariable(args.name, args.value);
				response.body = {
					value: args.value
				};
			}
			this.sendResponse(response);
		}
		catch (err) {
			this.sendErrorResponse(response, 11, `Could not continue: ${err}`);
		};
	}

	protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): void {
		let cb = (() => {
			this.debugReady = true;
			let all = [];
			args.breakpoints.forEach(brk => {
				all.push(this.miDebugger.addBreakPoint({ raw: brk.name, condition: brk.condition, countCondition: brk.hitCondition }));
			});
			Promise.all(all).then(brkpoints => {
				let finalBrks = [];
				brkpoints.forEach(brkp => {
					if (brkp[0])
						finalBrks.push({ line: brkp[1].line });
				});
				response.body = {
					breakpoints: finalBrks
				};
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 10, msg.toString());
			});
		}).bind(this);
		if (this.debugReady)
			cb();
		else
			this.miDebugger.once("debug-ready", cb);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		let cb = (() => {
			this.debugReady = true;
			this.miDebugger.clearBreakPoints().then(() => {
				let path = args.source.path;
				if (this.isSSH) {
					path = relative(this.trimCWD.replace(/\\/g, "/"), path.replace(/\\/g, "/"));
					if (!this.relative) {
						path = resolve(this.switchCWD.replace(/\\/g, "/"), path.replace(/\\/g, "/"));
					}
				}
				let all = [];
				args.breakpoints.forEach(brk => {
					all.push(this.miDebugger.addBreakPoint({ file: path, line: brk.line, condition: brk.condition, countCondition: brk.hitCondition }));
				});
				Promise.all(all).then(brkpoints => {
					let finalBrks = [];
					brkpoints.forEach(brkp => {
						if (brkp[0])
							finalBrks.push({ line: brkp[1].line });
					});
					response.body = {
						breakpoints: finalBrks
					};
					this.sendResponse(response);
				}, msg => {
					this.sendErrorResponse(response, 9, msg.toString());
				});
			}, msg => {
				this.sendErrorResponse(response, 9, msg.toString());
			});
		}).bind(this);
		if (this.debugReady)
			cb();
		else
			this.miDebugger.once("debug-ready", cb);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		response.body = {
			threads: [
				new Thread(this.threadID, "Thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		this.miDebugger.getStack(args.levels).then(stack => {
			let ret: StackFrame[] = [];
			stack.forEach(element => {
				let file = element.file;
				if (file) {
					if (this.isSSH) {
						file = relative(this.switchCWD.replace(/\\/g, "/"), file.replace(/\\/g, "/"));
						file = systemPath.resolve(this.trimCWD.replace(/\\/g, "/"), file.replace(/\\/g, "/"));
					}
					else if (process.platform === "win32") {
						if (file.startsWith("\\cygdrive\\") || file.startsWith("/cygdrive/")) {
							file = file[10] + ":" + file.substr(11); // replaces /cygdrive/c/foo/bar.txt with c:/foo/bar.txt
						}
					}
					ret.push(new StackFrame(element.level, element.function + "@" + element.address, new Source(element.fileName, file), element.line, 0));
				}
				else
					ret.push(new StackFrame(element.level, element.function + "@" + element.address, null, element.line, 0));
			});
			response.body = {
				stackFrames: ret
			};
			this.sendResponse(response);
		}, err => {
			this.sendErrorResponse(response, 12, `Failed to get Stack Trace: ${err.toString()}`)
		});
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		// FIXME: Does not seem to get called in january release
		if (this.needContinue) {
			this.miDebugger.continue().then(done => {
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
			});
		}
		else
			this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", STACK_HANDLES_START + (parseInt(args.frameId as any) || 0), false));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
		const variables: DebugProtocol.Variable[] = [];
		let id: number | string | VariableObject | ExtendedVariable;
		if (args.variablesReference < VAR_HANDLES_START) {
			id = args.variablesReference - STACK_HANDLES_START;
		}
		else {
			id = this.variableHandles.get(args.variablesReference);
		}

		let createVariable = (arg, options?) => {
			if (options)
				return this.variableHandles.create(new ExtendedVariable(arg, options));
			else
				return this.variableHandles.create(arg);
		};

		let findOrCreateVariable = (varObj: VariableObject): number => {
			let id: number;
			if (this.variableHandlesReverse.hasOwnProperty(varObj.name)) {
				id = this.variableHandlesReverse[varObj.name];
			}
			else {
				id = createVariable(varObj);
				this.variableHandlesReverse[varObj.name] = id;
			}
			return varObj.isCompound() ? id : 0;
		};

		if (typeof id == "number") {
			let stack: Variable[];
			try {
				stack = await this.miDebugger.getStackVariables(this.threadID, id);
				for (const variable of stack) {
					if (this.useVarObjects) {
						try {
							let varObjName = `var_${variable.name}`;
							let varObj: VariableObject;
							try {
								const changes = await this.miDebugger.varUpdate(varObjName);
								const changelist = changes.result("changelist");
								changelist.forEach((change) => {
									const name = MINode.valueOf(change, "name");
									const vId = this.variableHandlesReverse[varObjName];
									const v = this.variableHandles.get(vId) as any;
									v.applyChanges(change);
								});
								const varId = this.variableHandlesReverse[varObjName];
								varObj = this.variableHandles.get(varId) as any;
							}
							catch (err) {
								if (err instanceof MIError && err.message == "Variable object not found") {
									varObj = await this.miDebugger.varCreate(variable.name, varObjName);
									const varId = findOrCreateVariable(varObj);
									varObj.exp = variable.name;
									varObj.id = varId;
								}
								else {
									throw err;
								}
							}
							variables.push(varObj.toProtocolVariable());
						}
						catch (err) {
							variables.push({
								name: variable.name,
								value: `<${err}>`,
								variablesReference: 0
							});
						}
					}
					else {
						if (variable.valueStr !== undefined) {
							let expanded = expandValue(createVariable, `{${variable.name}=${variable.valueStr})`, "", variable.raw);
							if (expanded) {
								if (typeof expanded[0] == "string")
									expanded = [
										{
											name: "<value>",
											value: prettyStringArray(expanded),
											variablesReference: 0
										}
									];
								variables.push(expanded[0]);
							}
						} else
							variables.push({
								name: variable.name,
								type: variable.type,
								value: "<unknown>",
								variablesReference: createVariable(variable.name)
							});
					}
				}
				response.body = {
					variables: variables
				};
				this.sendResponse(response);
			}
			catch (err) {
				this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
			}
		}
		else if (typeof id == "string") {
			// Variable members
			let variable;
			try {
				variable = await this.miDebugger.evalExpression(JSON.stringify(id));
				try {
					let expanded = expandValue(createVariable, variable.result("value"), id, variable);
					if (!expanded) {
						this.sendErrorResponse(response, 2, `Could not expand variable`);
					}
					else {
						if (typeof expanded[0] == "string")
							expanded = [
								{
									name: "<value>",
									value: prettyStringArray(expanded),
									variablesReference: 0
								}
							];
						response.body = {
							variables: expanded
						};
						this.sendResponse(response);
					}
				}
				catch (e) {
					this.sendErrorResponse(response, 2, `Could not expand variable: ${e}`);
				}
			}
			catch (err) {
				this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
			}
		}
		else if (typeof id == "object") {
			if (id instanceof VariableObject) {
				// Variable members
				let children: VariableObject[];
				try {
					children = await this.miDebugger.varListChildren(id.name);
					const vars = children.map(child => {
						const varId = findOrCreateVariable(child);
						child.id = varId;
						return child.toProtocolVariable();
					});

					response.body = {
						variables: vars
					}
					this.sendResponse(response);
				}
				catch (err) {
					this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
				}
			}
			else if (id instanceof ExtendedVariable) {
				let varReq = id;
				if (varReq.options.arg) {
					let strArr = [];
					let argsPart = true;
					let arrIndex = 0;
					let submit = () => {
						response.body = {
							variables: strArr
						};
						this.sendResponse(response);
					};
					let addOne = async () => {
						const variable = await this.miDebugger.evalExpression(JSON.stringify(`${varReq.name}+${arrIndex})`));
						try {
							let expanded = expandValue(createVariable, variable.result("value"), varReq.name, variable);
							if (!expanded) {
								this.sendErrorResponse(response, 15, `Could not expand variable`);
							}
							else {
								if (typeof expanded == "string") {
									if (expanded == "<nullptr>") {
										if (argsPart)
											argsPart = false;
										else
											return submit();
									}
									else if (expanded[0] != '"') {
										strArr.push({
											name: "[err]",
											value: expanded,
											variablesReference: 0
										});
										return submit();
									}
									strArr.push({
										name: `[${(arrIndex++)}]`,
										value: expanded,
										variablesReference: 0
									});
									addOne();
								}
								else {
									strArr.push({
										name: "[err]",
										value: expanded,
										variablesReference: 0
									});
									submit();
								}
							}
						}
						catch (e) {
							this.sendErrorResponse(response, 14, `Could not expand variable: ${e}`);
						}
					};
					addOne();
				}
				else
					this.sendErrorResponse(response, 13, `Unimplemented variable request options: ${JSON.stringify(varReq.options)}`);
			}
			else {
				response.body = {
					variables: id
				};
				this.sendResponse(response);
			}
		}
		else {
			response.body = {
				variables: variables
			};
			this.sendResponse(response);
		}
	}

	protected pauseRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.miDebugger.interrupt().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 3, `Could not pause: ${msg}`);
		});
	}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments): void {
		this.miDebugger.continue(true).then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
		});
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.miDebugger.continue().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
		});
	}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		this.miDebugger.step(true).then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 4, `Could not step back: ${msg} - Try running 'target record-full' before stepping back`);
		});
	}

	protected stepInRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.step().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 4, `Could not step in: ${msg}`);
		});
	}

	protected stepOutRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.stepOut().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 5, `Could not step out: ${msg}`);
		});
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.miDebugger.next().then(done => {
			this.sendResponse(response);
		}, msg => {
			this.sendErrorResponse(response, 6, `Could not step over: ${msg}`);
		});
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		if (args.context == "watch" || args.context == "hover")
			this.miDebugger.evalExpression(args.expression).then((res) => {
				response.body = {
					variablesReference: 0,
					result: res.result("value")
				}
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 7, msg.toString());
			});
		else {
			this.miDebugger.sendUserInput(args.expression).then(output => {
				if (typeof output == "undefined")
					response.body = {
						result: "",
						variablesReference: 0
					};
				else
					response.body = {
						result: JSON.stringify(output),
						variablesReference: 0
					};
				this.sendResponse(response);
			}, msg => {
				this.sendErrorResponse(response, 8, msg.toString());
			});
		}
	}
}

function prettyStringArray(strings) {
	if (typeof strings == "object") {
		if (strings.length !== undefined)
			return strings.join(", ");
		else
			return JSON.stringify(strings);
	}
	else return strings;
}
